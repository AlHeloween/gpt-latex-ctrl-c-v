/**
 * Real network test: google-free should preserve COF sentinel markers.
 *
 * This is intentionally NOT part of tests/run_all.py because it depends on network stability.
 *
 * Run:
 *   node tests/test_translation_google_free_real_preserves_anchors.js
 */

const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function extractAnchors(s) {
  const text = String(s || "");
  const re = /\[\[COF_(?:FORMULA|CODE)_\d+\]\]/g;
  return text.match(re) || [];
}

async function main() {
  // DOM env (cof-translate expects window/document in some helper paths)
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost",
    pretendToBeVisual: true,
  });
  global.window = dom.window;
  global.document = dom.window.document;
  global.DOMParser = dom.window.DOMParser;

  // Minimal cof globals
  global.__cof = { diag: () => {}, core: {} };

  // Use real fetch
  if (typeof globalThis.fetch === "undefined") {
    throw new Error("fetch missing (Node 18+ required)");
  }
  global.fetch = globalThis.fetch;

  const translatePath = path.join(__dirname, "..", "extension", "lib", "cof-translate.js");
  const code = fs.readFileSync(translatePath, "utf8");
  // eslint-disable-next-line no-eval
  eval(code);

  const translate = global.__cof.translate;
  assert(translate && translate.translateWithGoogleFree, "translateWithGoogleFree missing");

  const token = "COF_REAL_TOKEN_123456";
  const input = `Hello [[COF_FORMULA_0]] and [[COF_CODE_1]].\n${token}`;
  const out = await translate.translateWithGoogleFree(input, "es");

  const inAnchors = extractAnchors(input).sort();
  const outAnchors = extractAnchors(out).sort();
  assert(out.includes(token), "output must include trailing token");
  assert(inAnchors.length === outAnchors.length, "anchor count mismatch (google-free did not preserve markers)");
  for (let i = 0; i < inAnchors.length; i++) {
    assert(inAnchors[i] === outAnchors[i], `anchor mismatch at ${i}: ${inAnchors[i]} vs ${outAnchors[i]}`);
  }

  console.log("OK: google-free real endpoint preserved anchors");
}

main().catch((e) => {
  console.error("FAIL:", e && e.stack ? e.stack : String(e));
  process.exit(1);
});
