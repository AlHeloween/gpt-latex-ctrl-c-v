/**
 * Deterministic unit test: Google free endpoint chunking.
 *
 * Goal: ensure translateWithGoogleFree() never sends oversized requests and
 * preserves content across chunks (no "first segment only" truncation).
 *
 * Run:
 *   node tests/test_translation_google_free_chunking.js
 */

const fs = require("fs");
const path = require("path");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function assertNoPartialCofSentinels(s) {
  const text = String(s || "");
  let i = 0;
  while (true) {
    const open = text.indexOf("[[COF_", i);
    const close = text.indexOf("]]", i);
    if (open === -1 && close === -1) break;
    // Close without open => partial from previous chunk.
    if (close !== -1 && (open === -1 || close < open)) {
      throw new Error("partial COF sentinel detected in request chunk (saw ']]' before '[[COF_')");
    }
    // Open must have a close in the same chunk.
    const end = text.indexOf("]]", open + 6);
    if (end === -1) {
      throw new Error("partial COF sentinel detected in request chunk (missing ']]')");
    }
    i = end + 2;
  }
}

function extractAnchors(s) {
  const text = String(s || "");
  const re = /\[\[COF_(?:FORMULA|CODE)_\d+\]\]/g;
  return text.match(re) || [];
}

async function main() {
  global.__cof = { diag: () => {}, core: {} };

  // Load the translation module (IIFE that attaches to globalThis.__cof.translate).
  const translatePath = path.join(__dirname, "..", "extension", "lib", "cof-translate.js");
  const code = fs.readFileSync(translatePath, "utf8");
  // eslint-disable-next-line no-eval
  eval(code);

  const translate = global.__cof.translate;
  assert(translate && translate.translateWithGoogleFree, "translateWithGoogleFree missing");

  const calls = [];
  global.fetch = async (_url, options) => {
    const body = String(options && options.body ? options.body : "");
    const params = new URLSearchParams(body);
    const q = params.get("q") || "";
    assertNoPartialCofSentinels(q);
    calls.push({ qLen: q.length });

    // Hard guard: the production code should keep requests small enough to avoid 413.
    if (q.length > 4500) {
      return {
        ok: false,
        status: 413,
        statusText: "Payload Too Large",
        json: async () => ({}),
        text: async () => "",
      };
    }

    // Mimic Google free endpoint JSON shape: data[0] is a list of segments.
    // Return exactly one segment per request.
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => [[[`T:${q}`, q, null, null, 1]]],
      text: async () => "",
    };
  };

  const token = "TOKEN_END_123456";
  // Force a boundary case where a naive split would cut inside the sentinel marker.
  const pad = "A".repeat(4494);
  const marker = "[[COF_FORMULA_0]]";
  const tail = " B ".repeat(80) + "[[COF_CODE_1]]" + " " + token;
  const big = pad + marker + tail; // marker crosses the 4500 boundary

  const out = await translate.translateWithGoogleFree(big, "es");

  assert(calls.length > 1, `expected chunking (calls=${calls.length})`);
  assert(out.includes(token), "output must include trailing token (avoid truncation)");
  assert(out.includes("T:"), "output must include translated segments");
  const inAnchors = extractAnchors(big).sort();
  const outAnchors = extractAnchors(out).sort();
  assert(inAnchors.length === outAnchors.length, "anchor count mismatch after translation");
  for (let i = 0; i < inAnchors.length; i++) {
    assert(inAnchors[i] === outAnchors[i], `anchor mismatch at ${i}: ${inAnchors[i]} vs ${outAnchors[i]}`);
  }
  console.log("OK: google-free chunking test passed");
}

main().catch((e) => {
  console.error("FAIL:", e && e.stack ? e.stack : String(e));
  process.exit(1);
});
