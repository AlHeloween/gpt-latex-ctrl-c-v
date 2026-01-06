/**
 * Deterministic unit test: chunking for "google" (paid API shape) without network.
 *
 * Goal: ensure we never send oversized q payloads and we preserve content across chunks.
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
    if (close !== -1 && (open === -1 || close < open)) {
      throw new Error("partial COF sentinel detected in request chunk (saw ']]' before '[[COF_')");
    }
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

  const translatePath = path.join(__dirname, "..", "extension", "lib", "cof-translate.js");
  const code = fs.readFileSync(translatePath, "utf8");
  // eslint-disable-next-line no-eval
  eval(code);

  const translate = global.__cof.translate;
  assert(translate && translate.translate, "translate.translate missing");

  const calls = [];
  global.fetch = async (url, options) => {
    const u = String(url || "");
    assert(u.includes("translation.googleapis.com/language/translate/v2"), `unexpected url: ${u}`);
    const body = JSON.parse(String(options && options.body ? options.body : "{}"));
    const q = String(body.q || "");
    assertNoPartialCofSentinels(q);
    calls.push({ qLen: q.length });
    // Cap should be enforced by chunking.
    if (q.length > 9000) {
      return { ok: false, status: 413, statusText: "Payload Too Large", text: async () => "" };
    }
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ data: { translations: [{ translatedText: `T:${q}` }] } }),
      text: async () => "",
    };
  };

  const token = "TOKEN_END_ABCDEF";
  const pad = "A".repeat(8994);
  const marker = "[[COF_FORMULA_0]]";
  const tail = " B ".repeat(200) + "[[COF_CODE_1]]" + " " + token;
  const big = pad + marker + tail; // marker crosses the 9000 boundary

  const config = {
    apiKeys: { google: "fake-key", microsoft: "", chatgpt: "", gemini: "", pollinations: "", custom: "" },
    customApi: { endpoint: "", headers: {}, method: "POST", payloadFormat: {} },
    translation: { translateFormulas: false, useWasm: false },
  };

  const out = await translate.translate(big, "es", "google", config, null, null, null);
  assert(calls.length > 1, `expected chunking (calls=${calls.length})`);
  assert(out.includes(token), "output must include trailing token");
  const inAnchors = extractAnchors(big).sort();
  const outAnchors = extractAnchors(out).sort();
  assert(inAnchors.length === outAnchors.length, "anchor count mismatch after translation");
  for (let i = 0; i < inAnchors.length; i++) {
    assert(inAnchors[i] === outAnchors[i], `anchor mismatch at ${i}: ${inAnchors[i]} vs ${outAnchors[i]}`);
  }
  console.log("OK: paid-google chunking test passed");
}

main().catch((e) => {
  console.error("FAIL:", e && e.stack ? e.stack : String(e));
  process.exit(1);
});
