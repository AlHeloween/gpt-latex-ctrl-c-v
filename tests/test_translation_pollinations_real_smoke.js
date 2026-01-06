/**
 * Pollinations real-network smoke test (manual inspection).
 *
 * Creates a >4k HTML sample with code + math spans, runs:
 *   anchor -> pollinations translate -> restore
 * and writes artifacts for manual review.
 *
 * Run:
 *   node tests/test_translation_pollinations_real_smoke.js
 *
 * Output:
 *   artifacts/pollinations_real_smoke/*
 */

const fs = require("fs");
const path = require("path");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

function writeText(p, s) {
  mkdirp(path.dirname(p));
  fs.writeFileSync(p, String(s || ""), { encoding: "utf8" });
}

function fnv1a32Hex(s) {
  let hash = 0x811c9dc5;
  const str = String(s || "");
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function hasCyrillic(s) {
  return /[А-Яа-яЁё]/.test(String(s || ""));
}

function getEnvKey() {
  const keys = ["TRANSLATION_TEST_POLLINATIONS_KEY", "POLLINATIONS_API_KEY", "POLLINATIONS_KEY"];
  for (const k of keys) {
    const v = String(process.env[k] || "").trim();
    if (v) return v;
  }
  return "";
}

function buildLargeHtml() {
  const para =
    "<p>Similarly, the Permian Basin case study highlights the value of Asset Integrity. " +
    "The cost of an ESP replacement includes the new pump hardware, the workover rig time, " +
    "and the deferred production while the well is offline. Extending run life from days to months " +
    "fundamentally changes the profitability profile of the well.</p>";

  const code =
    "<pre><code class=\"language-python\">" +
    "def hello(name):\n" +
    "    # keep this code exactly\n" +
    "    return f\"Hello, {name}!\"\n" +
    "\n" +
    "print(hello('world'))\n" +
    "</code></pre>";

  const math =
    "<p>Inline math: <span class=\"math-inline\" data-math=\"E=mc^2\">E=mc^2</span> " +
    "and another <span class=\"math-inline\" data-math=\"\\\\int_0^1 x^2 dx\">∫</span>.</p>";

  const list =
    "<ul>" +
    "<li>Operational Context and Vendor Ecosystem</li>" +
    "<li>Andalas Petroleum Services: key service provider</li>" +
    "<li>FreeFlow Systems: integration partner</li>" +
    "</ul>";

  // Build > 4k
  const blocks = [];
  blocks.push("<h2>7. Operational Context and Vendor Ecosystem</h2>");
  blocks.push(list);
  for (let i = 0; i < 18; i++) blocks.push(para);
  blocks.push(code);
  blocks.push(math);
  for (let i = 0; i < 6; i++) blocks.push(para);

  const html = `<div id="content">${blocks.join("\n")}</div>`;
  assert(html.length >= 4000, `expected >=4k input, got ${html.length}`);
  return html;
}

async function main() {
  // Ensure Node 18+ fetch exists.
  if (typeof globalThis.fetch !== "function") {
    throw new Error("global fetch missing (Node 18+ required)");
  }

  // Load extension modules (IIFEs attach to globalThis.__cof)
  global.__cof = { diag: () => {}, core: {} };
  global.fetch = globalThis.fetch;

  const root = path.join(__dirname, "..");
  const libDir = path.join(root, "extension", "lib");
  // eslint-disable-next-line no-eval
  eval(fs.readFileSync(path.join(libDir, "cof-anchor.js"), "utf8"));
  // eslint-disable-next-line no-eval
  eval(fs.readFileSync(path.join(libDir, "cof-translate.js"), "utf8"));

  const anchor = global.__cof.anchor;
  const translate = global.__cof.translate;
  assert(anchor && translate, "failed to load cof modules");

  const html = buildLargeHtml();
  const { html: anchoredHtml, anchors } = anchor.anchorFormulasAndCode(html);

  const progress = [];
  const config = {
    translation: {
      enabled: true,
      service: "pollinations",
      defaultLanguage: "ru",
      translateFormulas: false,
      timeoutMs: 60000,
      maxConcurrency: 6, // should still serialize
      useWasm: false,
    },
    keyboard: { interceptCopy: false },
    apiKeys: { pollinations: getEnvKey() },
    customApi: { endpoint: "" },
  };

  const outDir = path.join(root, "artifacts", "pollinations_real_smoke");
  mkdirp(outDir);

  let translatedAnchored = "";
  let restored = "";
  let ms = 0;
  let error = "";
  try {
    const t0 = Date.now();
    translatedAnchored = await translate.translate(
      anchoredHtml,
      "ru",
      "pollinations",
      config,
      null,
      null,
      anchors,
      (p) => {
        if (p && typeof p === "object") progress.push(p);
      }
    );
    ms = Date.now() - t0;
    restored = anchor.restoreAnchors(translatedAnchored, anchors, false);
  } catch (e) {
    error = String(e?.message || e || "unknown error");
  }

  // Always write artifacts for manual inspection.
  writeText(path.join(outDir, "input.html"), html);
  writeText(path.join(outDir, "anchored.html"), anchoredHtml);
  writeText(path.join(outDir, "translated_anchored.html"), translatedAnchored);
  writeText(path.join(outDir, "restored.html"), restored);
  writeText(path.join(outDir, "progress.json"), JSON.stringify(progress, null, 2));

  const checks = {
    hasReasoningLeak: String(translatedAnchored || "").includes("reasoning_content"),
    hasWrapperLeak: String(translatedAnchored || "").includes("<COF_OUT>") || String(translatedAnchored || "").includes("<COF_IN>"),
    hasAnchorsLeakAfterRestore: /\[\[COF_(FORMULA|CODE)_\d+\]\]/.test(String(restored || "")),
    hasCodeAfterRestore: restored.includes("<pre>") && restored.includes("</pre>") && restored.includes("language-python"),
    hasMathAfterRestore: restored.includes("data-math="),
    hasCyrillic: hasCyrillic(restored),
    hasContainerAfterRestore: restored.includes("<div id=\"content\">") && restored.includes("</div>"),
    sizeSeemsReasonable: restored.length >= Math.floor(html.length * 0.5),
  };

  writeText(
    path.join(outDir, "meta.json"),
    JSON.stringify(
      {
        ms,
        error: error || null,
        checks,
        inputLen: html.length,
        anchoredLen: anchoredHtml.length,
        translatedAnchoredLen: String(translatedAnchored || "").length,
        restoredLen: restored.length,
        inputHash: fnv1a32Hex(html),
        anchoredHash: fnv1a32Hex(anchoredHtml),
        translatedAnchoredHash: fnv1a32Hex(translatedAnchored),
        restoredHash: fnv1a32Hex(restored),
        anchors: {
          formulas: (anchors.formulas || []).length,
          codes: (anchors.codes || []).length,
        },
      },
      null,
      2
    )
  );

  console.log("WROTE:", outDir);
  console.log("Check:", path.join(outDir, "meta.json"));
  if (error) {
    console.log("FAIL: translation threw (see meta.json error)");
    process.exitCode = 1;
    return;
  }
  if (checks.hasWrapperLeak || checks.hasAnchorsLeakAfterRestore || !checks.hasCodeAfterRestore || !checks.hasMathAfterRestore || !checks.hasContainerAfterRestore || !checks.sizeSeemsReasonable) {
    console.log("FAIL: output failed integrity checks; inspect artifacts");
    process.exitCode = 1;
    return;
  }
  if (!checks.hasCyrillic) {
    console.log("NOTE: no Cyrillic detected; inspect restored.html manually");
    return;
  }
  console.log("OK: Cyrillic detected; inspect restored.html manually");
}

main().catch((e) => {
  console.error("FAIL:", e && e.stack ? e.stack : String(e));
  process.exitCode = 1;
});
