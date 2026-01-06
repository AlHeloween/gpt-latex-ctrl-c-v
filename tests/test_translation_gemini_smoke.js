/**
 * Gemini translate smoke tests (mocked, deterministic; no network).
 *
 * Ensures:
 * - Uses v1beta endpoint by default
 * - Falls back to v1 on 404
 * - Sends generateContent payload in the expected shape
 *
 * Run:
 *   node tests/test_translation_gemini_smoke.js
 */

const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
global.window = dom.window;
global.document = dom.window.document;
global.DOMParser = dom.window.DOMParser;
global.navigator = { ...dom.window.navigator };

global.browser = { storage: { local: { get: async () => ({}), set: async () => {} } } };
global.__cof = { diag: () => {} };

const extensionLib = path.join(__dirname, "..", "extension", "lib");
// eslint-disable-next-line no-eval
eval(fs.readFileSync(path.join(extensionLib, "cof-translate.js"), "utf8"));
const translate = global.__cof.translate;
assert(translate && translate.translateWithGemini, "translate module not loaded");

async function testPrefersV1Beta() {
  let sawUrl = "";
  global.fetch = async (url, options) => {
    sawUrl = String(url || "");
    assert(sawUrl.includes("/v1beta/models/"), `expected v1beta url, got ${sawUrl}`);
    assert(sawUrl.includes(":generateContent"), "expected generateContent call");
    assert(sawUrl.includes("?key="), "expected ?key=");
    const body = JSON.parse(String(options?.body || "{}"));
    assert(Array.isArray(body.contents), "expected contents[]");
    assert(body.contents[0]?.parts?.[0]?.text, "expected parts[0].text");
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: "HOLA" }] } }] }),
      json: async () => ({ candidates: [{ content: { parts: [{ text: "HOLA" }] } }] }),
      headers: { get: () => null },
    };
  };
  const out = await translate.translateWithGemini("Hello", "es", "fake_key", null, null);
  assert(out === "HOLA", `expected HOLA, got ${JSON.stringify(out)}`);
}

async function testFallsBackToV1On404() {
  const urls = [];
  global.fetch = async (url) => {
    const u = String(url || "");
    urls.push(u);
    if (u.includes("/v1beta/")) {
      return {
        ok: false,
        status: 404,
        text: async () => '{"error":{"code":404,"message":"models/gemini-1.5-flash is not found for API version v1beta"}}',
        json: async () => {
          throw new Error("no json");
        },
        headers: { get: () => null },
      };
    }
    assert(u.includes("/v1/models/"), `expected v1 fallback url, got ${u}`);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: "OK" }] } }] }),
      json: async () => ({ candidates: [{ content: { parts: [{ text: "OK" }] } }] }),
      headers: { get: () => null },
    };
  };

  const out = await translate.translateWithGemini("Hello", "es", "fake_key", null, null);
  assert(out === "OK", `expected OK, got ${JSON.stringify(out)}`);
  assert(urls.length === 2, `expected 2 attempts, got ${urls.length}`);
}

async function main() {
  await testPrefersV1Beta();
  await testFallsBackToV1On404();
  console.log("OK: gemini smoke tests passed");
}

main().catch((e) => {
  console.error("FAIL:", e && e.stack ? e.stack : String(e));
  process.exit(1);
});

