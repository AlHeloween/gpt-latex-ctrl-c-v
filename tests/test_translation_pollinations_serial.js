/**
 * Ensure Pollinations translation never runs concurrent HTTP requests.
 *
 * Pollinations is often rate-limited to a single in-flight request; if we send chunks
 * in parallel, it can fail intermittently. This test enforces concurrency=1 at the
 * translate() layer regardless of user maxConcurrency settings.
 *
 * Run:
 *   node tests/test_translation_pollinations_serial.js
 */

const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// DOM-ish environment for module IIFEs.
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
global.window = dom.window;
global.document = dom.window.document;
global.DOMParser = dom.window.DOMParser;
global.navigator = { ...dom.window.navigator };

// No runtime.sendMessage: fetchCompat will use global.fetch directly.
global.browser = { storage: { local: { get: async () => ({}), set: async () => {} } } };
global.__cof = { diag: () => {} };

// Fake fetch with latency + concurrency tracking.
let inflight = 0;
let peak = 0;
global.fetch = async (url, options) => {
  inflight += 1;
  peak = Math.max(peak, inflight);
  // Force observable overlap if concurrency > 1.
  await new Promise((r) => setTimeout(r, 40));

  // Respond with an OpenAI-compatible JSON payload.
  const body = String(options?.body || "");
  let chunk = "";
  try {
    const j = JSON.parse(body);
    const prompt = String(j?.messages?.[1]?.content || "");
    const open = prompt.indexOf("<COF_IN>");
    const close = prompt.indexOf("</COF_IN>");
    if (open >= 0 && close > open) {
      chunk = prompt.slice(open + "<COF_IN>".length, close).trim();
    }
  } catch (_e) {
    chunk = "";
  }

  const out = JSON.stringify({
    choices: [{ message: { content: `<COF_OUT>${chunk}</COF_OUT>` } }],
  });

  inflight -= 1;
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => out,
    json: async () => JSON.parse(out),
    headers: { get: () => null },
  };
};

// Load modules (IIFEs attach to globalThis.__cof)
const extensionLib = path.join(__dirname, "..", "extension", "lib");
const translateCode = fs.readFileSync(path.join(extensionLib, "cof-translate.js"), "utf8");
// eslint-disable-next-line no-eval
eval(translateCode);

const translate = global.__cof.translate;
assert(translate && translate.translate, "cof-translate.js did not initialize translate.translate");

async function main() {
  // Make content large enough to chunk under pollinations maxChars (~6000).
  const chunkMe = ("Hello world. ").repeat(2000); // ~24k

  const config = {
    translation: {
      enabled: true,
      service: "pollinations",
      defaultLanguage: "es",
      // User may set higher; implementation must still serialize.
      maxConcurrency: 6,
      useWasm: false,
    },
    keyboard: { interceptCopy: false },
    apiKeys: { pollinations: "" },
    customApi: { endpoint: "" },
  };

  await translate.translate(chunkMe, "es", "pollinations", config, null, null, null, null);
  assert(peak === 1, `Pollinations requests must be serialized (peak_concurrency=${peak})`);
  console.log("OK: pollinations concurrency is 1");
}

main().catch((e) => {
  console.error("FAIL:", e && e.stack ? e.stack : String(e));
  process.exit(1);
});
