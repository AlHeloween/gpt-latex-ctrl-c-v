/**
 * Deterministic unit test: LLM services must preserve anchor markers.
 *
 * We simulate a provider response that mutates/removes markers and ensure
 * the translation pipeline throws (so copy can fail-open to original selection).
 */

const fs = require("fs");
const path = require("path");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  global.__cof = { diag: () => {}, core: {} };

  const translatePath = path.join(__dirname, "..", "extension", "lib", "cof-translate.js");
  const code = fs.readFileSync(translatePath, "utf8");
  // eslint-disable-next-line no-eval
  eval(code);

  const translate = global.__cof.translate;
  assert(translate && translate.translate, "translate.translate missing");

  const input = "Hello [[COF_FORMULA_0]] and [[COF_CODE_1]]!";
  const config = {
    apiKeys: { chatgpt: "fake", google: "", microsoft: "", gemini: "", pollinations: "", custom: "" },
    customApi: { endpoint: "", headers: {}, method: "POST", payloadFormat: {} },
    translation: { translateFormulas: false, useWasm: false },
  };

  // Case 1: provider preserves markers -> should pass.
  global.fetch = async (url, options) => {
    const u = String(url || "");
    if (!u.includes("/v1/chat/completions")) throw new Error(`unexpected url: ${u}`);
    const body = JSON.parse(String(options && options.body ? options.body : "{}"));
    const prompt = body?.messages?.[0]?.content || "";
    assert(String(prompt).includes("Text to translate:"), "unexpected prompt shape");
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ choices: [{ message: { content: `T:${input}` } }] }),
      text: async () => "",
    };
  };
  const okOut = await translate.translate(input, "es", "chatgpt", config, null, null, null);
  assert(okOut.includes("[[COF_FORMULA_0]]"), "marker missing in preserved-case output");

  // Case 2: provider mutates markers -> must throw.
  global.fetch = async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({ choices: [{ message: { content: "T:Hello COF_FORMULA_0 and [[COF_CODE_1]]!" } }] }),
    text: async () => "",
  });
  let threw = false;
  try {
    await translate.translate(input, "es", "chatgpt", config, null, null, null);
  } catch (e) {
    threw = true;
    assert(String(e).includes("integrity check failed"), "expected integrity-check error");
  }
  assert(threw, "expected translation to throw on marker mutation");

  console.log("OK: LLM marker integrity test passed");
}

main().catch((e) => {
  console.error("FAIL:", e && e.stack ? e.stack : String(e));
  process.exit(1);
});
