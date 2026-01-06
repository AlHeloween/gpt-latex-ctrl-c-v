/**
 * Pollinations response parsing smoke tests for invalid JSON edge cases.
 *
 * Some pollinations /openai proxy responses may contain invalid JSON due to unescaped newlines
 * in reasoning fields. We must still extract message.content when present, and fail fast when not.
 *
 * Run:
 *   node tests/test_translation_pollinations_invalid_json_smoke.js
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
const translateCode = fs.readFileSync(path.join(extensionLib, "cof-translate.js"), "utf8");
// eslint-disable-next-line no-eval
eval(translateCode);
const translate = global.__cof.translate;
assert(translate && translate.translateWithPollinations, "translate module not loaded");

async function run() {
  // Case 1: invalid JSON due to literal CRLF inside reasoning_content, but content is present and extractable.
  {
    const bad = `{"choices":[{"message":{"role":"assistant","reasoning_content":"line1\r\nline2","content":"<COF_OUT>Hola mundo</COF_OUT>"}}]}`;
    global.fetch = async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => bad,
      json: async () => {
        throw new Error("invalid json");
      },
      headers: { get: () => null },
    });
    const out = await translate.translateWithPollinations("Hello world", "es", "", null, null, undefined);
    assert(out === "Hola mundo", `expected extracted content, got=${JSON.stringify(out)}`);
  }

  // Case 2: invalid JSON that looks like /openai output but has no content/text -> must throw.
  {
    const bad = `{"choices":[{"message":{"role":"assistant","reasoning_content":"line1\r\nline2"}}]}`;
    global.fetch = async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => bad,
      json: async () => {
        throw new Error("invalid json");
      },
      headers: { get: () => null },
    });
    // No-key pollinations must be best-effort; when the response is unusable, it should fall back
    // to returning the original text so the copy pipeline doesn't break.
    const out = await translate.translateWithPollinations("Hello world", "es", "", null, null, undefined);
    assert(out === "Hello world", `expected fallback to original text, got=${JSON.stringify(out)}`);
  }

  console.log("OK: pollinations invalid-json smoke tests passed");
}

run().catch((e) => {
  console.error("FAIL:", e && e.stack ? e.stack : String(e));
  process.exit(1);
});
