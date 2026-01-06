/**
 * Pollinations smoke tests (mocked, deterministic).
 *
 * Covers:
 * - Concurrency is forced to 1 (no parallel in-flight requests)
 * - Request uses POST to the correct endpoint depending on key presence
 * - Response parsing supports multiple known shapes + non-JSON fallback
 *
 * Run:
 *   node tests/test_translation_pollinations_smoke.js
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
assert(translate && translate.translateWithPollinations && translate.translate, "translate module not loaded");

async function testParsingShapes() {
  const cases = [
    { name: "openai message.content (wrapped)", body: { choices: [{ message: { content: "<COF_OUT>Hola mundo</COF_OUT>" } }] }, want: "Hola mundo" },
    { name: "openai choices.text (wrapped)", body: { choices: [{ text: "<COF_OUT>Hola mundo</COF_OUT>" }] }, want: "Hola mundo" },
    { name: "openai choices.content (wrapped)", body: { choices: [{ content: "<COF_OUT>Hola mundo</COF_OUT>" }] }, want: "Hola mundo" },
    { name: "legacy text (wrapped)", body: { text: "<COF_OUT>Hola mundo</COF_OUT>" }, want: "Hola mundo" },
    { name: "legacy result (wrapped)", body: { result: "<COF_OUT>Hola mundo</COF_OUT>" }, want: "Hola mundo" },
  ];

  for (const mode of ["no-key", "with-key"]) {
    global.fetch = async (url, options) => {
      // Ensure request is the OpenAI-like POST we expect.
      const urlStr = String(url || "");
      if (mode === "with-key") {
        assert(urlStr.includes("/v1/chat/completions"), `expected /v1/chat/completions endpoint, got ${urlStr}`);
      } else {
        assert(urlStr.includes("/openai"), `expected /openai endpoint, got ${urlStr}`);
      }
      assert(String(options?.method || "").toUpperCase() === "POST", "expected POST");
      const body = JSON.parse(String(options?.body || "{}"));
      assert(Array.isArray(body.messages), "expected messages[]");
      assert(body.messages[0]?.role === "system", "expected system role message first");
      assert(body.messages[1]?.role === "user", "expected user role message second");
      assert(String(body.messages[1]?.content || "").includes("<COF_IN>"), "expected <COF_IN> wrapper in prompt");
      if (mode === "with-key") {
        assert(body.response_format?.type === "text", "expected response_format.type=text");
        assert(body.reasoning_effort === "none", "expected reasoning_effort=none");
        assert(body.thinking?.type === "disabled", "expected thinking.type=disabled");
      } else {
        assert(!("response_format" in body), "legacy /openai must not include response_format");
        assert(!("reasoning_effort" in body), "legacy /openai must not include reasoning_effort");
        assert(!("thinking" in body), "legacy /openai must not include thinking");
      }
      return {
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify(cases[0].body),
      json: async () => cases[0].body,
      headers: { get: () => null },
      };
    };

    for (const c of cases) {
      global.fetch = async (url, options) => {
        const urlStr = String(url || "");
        if (mode === "with-key") {
          assert(urlStr.includes("/v1/chat/completions"), `expected /v1/chat/completions endpoint, got ${urlStr}`);
          assert(String(options?.headers?.Authorization || "").startsWith("Bearer "), "expected Authorization Bearer header");
        } else {
          assert(urlStr.includes("/openai"), `expected /openai endpoint, got ${urlStr}`);
        }
        assert(String(options?.method || "").toUpperCase() === "POST", "expected POST");
        const body = JSON.parse(String(options?.body || "{}"));
        assert(Array.isArray(body.messages), "expected messages[]");
        assert(body.messages[0]?.role === "system", "expected system role message first");
        assert(body.messages[1]?.role === "user", "expected user role message second");
        assert(String(body.messages[1]?.content || "").includes("<COF_IN>"), "expected <COF_IN> wrapper in prompt");
        if (mode === "with-key") {
          assert(body.response_format?.type === "text", "expected response_format.type=text");
          assert(body.reasoning_effort === "none", "expected reasoning_effort=none");
          assert(body.thinking?.type === "disabled", "expected thinking.type=disabled");
        } else {
          assert(!("response_format" in body), "legacy /openai must not include response_format");
          assert(!("reasoning_effort" in body), "legacy /openai must not include reasoning_effort");
          assert(!("thinking" in body), "legacy /openai must not include thinking");
        }
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => JSON.stringify(c.body),
          json: async () => c.body,
          headers: { get: () => null },
        };
      };

      const key = mode === "with-key" ? "pk_test_key" : "";
      const out = await translate.translateWithPollinations("Hello world", "es", key, null, null, undefined);
      assert(String(out).trim() === c.want, `parse failed: ${c.name} mode=${mode} got=${JSON.stringify(out)}`);
    }
  }

  // Non-JSON fallback
  global.fetch = async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => " <COF_OUT>Hola mundo</COF_OUT>\n",
    json: async () => {
      throw new Error("not json");
    },
    headers: { get: () => null },
  });
  const out = await translate.translateWithPollinations("Hello world", "es", "", null, null, undefined);
  assert(out === "Hola mundo", `non-json fallback failed got=${JSON.stringify(out)}`);
}

async function testConcurrencyForcedToOne() {
  let inflight = 0;
  let peak = 0;
  const seenUrls = new Set();
  const seenBodies = [];

  global.fetch = async (url, options) => {
    inflight += 1;
    peak = Math.max(peak, inflight);
    seenUrls.add(String(url || ""));
    seenBodies.push(String(options?.body || ""));
    await new Promise((r) => setTimeout(r, 30));
    inflight -= 1;
    // Deterministic "translation": return the input chunk verbatim, wrapped.
    let chunk = "";
    try {
      const j = JSON.parse(String(options?.body || "{}"));
      const prompt = String(j?.messages?.[1]?.content || "");
      const open = prompt.indexOf("<COF_IN>");
      const close = prompt.indexOf("</COF_IN>");
      if (open >= 0 && close > open) {
        chunk = prompt.slice(open + "<COF_IN>".length, close).trim();
      }
    } catch (_e) {
      // ignore
    }
    const out = JSON.stringify({ choices: [{ message: { content: `<COF_OUT>${chunk}</COF_OUT>` } }] });
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => out,
      json: async () => JSON.parse(out),
      headers: { get: () => null },
    };
  };

  const long = ("Hello world. ").repeat(2000); // chunks for pollinations
  const cfg = {
    translation: { useWasm: false, maxConcurrency: 6 },
    apiKeys: { pollinations: "" },
    customApi: { endpoint: "" },
  };
  await translate.translate(long, "es", "pollinations", cfg, null, null, null, null);

  assert(peak === 1, `expected pollinations peak concurrency 1, got ${peak}`);
  assert(Array.from(seenUrls).some((u) => u.includes("pollinations.ai") && u.includes("/openai")), "expected /openai endpoint");
  assert(seenBodies.length >= 2, "expected chunking to produce multiple requests for long input");
  for (const b of seenBodies) {
    const j = JSON.parse(b);
    assert(j && j.messages && Array.isArray(j.messages), "expected OpenAI-like JSON body with messages[]");
  }
}

async function main() {
  await testParsingShapes();
  await testConcurrencyForcedToOne();
  console.log("OK: pollinations smoke tests passed");
}

main().catch((e) => {
  console.error("FAIL:", e && e.stack ? e.stack : String(e));
  process.exit(1);
});
