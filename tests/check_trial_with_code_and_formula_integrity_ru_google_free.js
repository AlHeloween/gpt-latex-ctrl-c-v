/**
 * Manual (real-network) integrity check for a user-provided HTML capture.
 *
 * Input: examples/selection_example_static.html
 * Action: translate a focused snippet to Russian using google-free
 * Checks:
 *  - code blocks preserved verbatim
 *  - data-math formula spans preserved verbatim (as formulas are anchored)
 *  - translated output contains Cyrillic outside code
 *  - output isn't truncated around the code block
 *
 * Run:
 *   node tests/check_trial_with_code_and_formula_integrity_ru_google_free.js
 */

const fs = require("fs");
const path = require("path");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function sha1(s) {
  // non-crypto; just for a stable short fingerprint
  let h = 2166136261 >>> 0;
  const str = String(s || "");
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function hasCyrillic(s) {
  return /[А-Яа-яЁё]/.test(String(s || ""));
}

async function main() {
  const root = path.join(__dirname, "..");
  const inputPath = path.join(root, "examples", "selection_example_static.html");
  const html = fs.readFileSync(inputPath, "utf8");

  const low = html.toLowerCase();
  const preStart = low.indexOf("<pre");
  assert(preStart >= 0, "no <pre> found in input");
  const preEnd = low.indexOf("</pre>", preStart);
  assert(preEnd >= 0, "no </pre> found after first <pre>");

  // Focused snippet: include some context before/after the first code block.
  const snippetStart = Math.max(0, preStart - 1500);
  const snippetEnd = Math.min(html.length, preEnd + 2000);
  const snippet = html.slice(snippetStart, snippetEnd);

  // Load extension modules (IIFEs attach to globalThis.__cof)
  global.__cof = { diag: () => {}, core: {} };
  // Ensure Node 18+ fetch
  if (typeof globalThis.fetch === "undefined") throw new Error("fetch missing (Node 18+ required)");
  global.fetch = globalThis.fetch;

  const anchorCode = fs.readFileSync(path.join(root, "extension", "lib", "cof-anchor.js"), "utf8");
  const translateCode = fs.readFileSync(path.join(root, "extension", "lib", "cof-translate.js"), "utf8");
  // eslint-disable-next-line no-eval
  eval(anchorCode);
  // eslint-disable-next-line no-eval
  eval(translateCode);

  const anchor = global.__cof.anchor;
  const translate = global.__cof.translate;
  assert(anchor && translate, "failed to load cof modules");

  const { html: anchoredHtml, anchors } = anchor.anchorFormulasAndCode(snippet);
  const codeCount = (anchors.codes || []).length;
  const formulaCount = (anchors.formulas || []).length;

  const config = {
    apiKeys: { google: "", microsoft: "", chatgpt: "", gemini: "", pollinations: "", custom: "" },
    customApi: { endpoint: "", headers: {}, method: "POST", payloadFormat: {} },
    translation: { enabled: true, service: "google-free", defaultLanguage: "ru", translateFormulas: false, maxConcurrency: 4, useWasm: false },
  };

  const progress = [];
  const translatedAnchored = await translate.translate(
    anchoredHtml,
    "ru",
    "google-free",
    config,
    null,
    null,
    anchors,
    (p) => {
      if (p && (p.phase === "chunk-done" || p.phase === "error")) progress.push(p);
    },
  );

  const restored = anchor.restoreAnchors(translatedAnchored, anchors, false);

  // Integrity checks
  for (const code of anchors.codes || []) {
    assert(restored.includes(code), `code block not preserved (hash=${sha1(code)} len=${code.length})`);
  }
  for (const f of anchors.formulas || []) {
    assert(restored.includes(f), `formula element not preserved (hash=${sha1(f)} len=${f.length})`);
  }

  // Ensure we didn't stop translating after the code: check Cyrillic exists outside the code block.
  let withoutCode = restored;
  for (const code of anchors.codes || []) {
    withoutCode = withoutCode.split(code).join("");
  }
  assert(hasCyrillic(withoutCode), "no Cyrillic found outside code blocks (translation likely failed/partial)");

  // Basic truncation guard: output should not be dramatically shorter than input snippet.
  assert(restored.length >= Math.floor(snippet.length * 0.7), `output seems truncated (in=${snippet.length} out=${restored.length})`);

  // Stable token after the code block that should remain (even if translated): section number marker.
  assert(restored.includes("3.3") || restored.includes("3.3 "), "missing post-code section marker '3.3' (likely truncation)");

  console.log("OK: trial_with_code_and_formula snippet integrity check passed");
  console.log(
    JSON.stringify(
      {
        snippetLen: snippet.length,
        anchoredLen: anchoredHtml.length,
        restoredLen: restored.length,
        codeCount,
        formulaCount,
        progressTail: progress.slice(-5),
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error("FAIL:", e && e.stack ? e.stack : String(e));
  process.exit(1);
});
