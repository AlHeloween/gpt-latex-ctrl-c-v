/**
 * translation_wasm.wasm smoke test (no network).
 *
 * Verifies:
 * - WASM imports are plain `env` (no wasm-bindgen glue required)
 * - Required exports exist
 * - translate_text runs with the async-bridge pattern (http_request + get_result)
 * - cache_get/cache_set are exercised (2nd call avoids HTTP)
 *
 * Run:
 *   uv run node tests/test_translation_wasm_smoke.js
 */

const fs = require("fs");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function u32(mem, ptr) {
  return new Uint32Array(mem.buffer, ptr, 1)[0];
}

function writeU32(mem, ptr, value) {
  new Uint32Array(mem.buffer, ptr, 1)[0] = value >>> 0;
}

function readUtf8(mem, ptr, len) {
  const bytes = new Uint8Array(mem.buffer, ptr, len);
  return new TextDecoder("utf-8").decode(bytes);
}

function writeUtf8(mem, ptr, s) {
  const bytes = new TextEncoder().encode(String(s));
  new Uint8Array(mem.buffer, ptr, bytes.length).set(bytes);
  return bytes.length;
}

function allocStr(exp, mem, s) {
  const bytes = new TextEncoder().encode(String(s));
  const ptr = exp.alloc(bytes.length);
  new Uint8Array(mem.buffer, ptr, bytes.length).set(bytes);
  return { ptr, len: bytes.length };
}

async function main() {
  const wasmPath = "extension/wasm/translation_wasm.wasm";
  const bytes = fs.readFileSync(wasmPath);

  const mod = await WebAssembly.compile(bytes);
  const imports = WebAssembly.Module.imports(mod);
  const importModules = [...new Set(imports.map((i) => i.module))];
  assert(importModules.length === 1 && importModules[0] === "env", `unexpected import modules: ${importModules.join(",")}`);

  let inst = null;
  let mem = null;

  const httpResults = new Map(); // callbackId -> json string
  const cacheResults = new Map(); // callbackId -> json string
  const cacheStore = new Map(); // key -> cacheEntry json string
  let httpCalls = 0;

  function env_cache_get(keyPtr, keyLen, callbackId) {
    const key = readUtf8(mem, keyPtr, keyLen);
    const entry = cacheStore.get(key);
    // Immediate resolution via cache_get_result: "null" means miss; otherwise CacheEntry JSON.
    cacheResults.set(callbackId, entry || "null");
  }

  function env_cache_get_result(callbackId, resultLenPtr) {
    if (!cacheResults.has(callbackId)) return 0;
    const s = cacheResults.get(callbackId);
    cacheResults.delete(callbackId);
    const bytes = new TextEncoder().encode(String(s));
    const ptr = inst.exports.alloc(bytes.length);
    new Uint8Array(mem.buffer, ptr, bytes.length).set(bytes);
    writeU32(mem, resultLenPtr, bytes.length);
    return ptr;
  }

  function env_cache_set(keyPtr, keyLen, valuePtr, valueLen) {
    const key = readUtf8(mem, keyPtr, keyLen);
    const value = readUtf8(mem, valuePtr, valueLen);
    cacheStore.set(key, value);
    return 1;
  }

  function env_http_request(urlPtr, urlLen, methodPtr, methodLen, headersPtr, headersLen, bodyPtr, bodyLen, callbackId) {
    httpCalls += 1;
    // We don't care about URL/method/headers/body in this smoke test; just respond deterministically.
    const response = {
      ok: true,
      status: 200,
      statusText: "OK",
      // CustomService.parse_response expects JSON with a "text" field.
      text: JSON.stringify({ text: "TRANSLATED_FROM_WASM" }),
      headers: {},
    };
    httpResults.set(callbackId, JSON.stringify(response));
  }

  function env_http_request_get_result(callbackId, resultLenPtr) {
    if (!httpResults.has(callbackId)) return 0;
    const s = httpResults.get(callbackId);
    httpResults.delete(callbackId);
    const bytes = new TextEncoder().encode(String(s));
    const ptr = inst.exports.alloc(bytes.length);
    new Uint8Array(mem.buffer, ptr, bytes.length).set(bytes);
    writeU32(mem, resultLenPtr, bytes.length);
    return ptr;
  }

  inst = await WebAssembly.instantiate(mod, {
    env: {
      cache_get: env_cache_get,
      cache_get_result: env_cache_get_result,
      cache_set: env_cache_set,
      http_request: env_http_request,
      http_request_get_result: env_http_request_get_result,
    },
  });
  mem = inst.exports.memory;

  const exp = inst.exports;
  for (const k of ["translation_api_version", "translate_text", "alloc", "dealloc", "last_len", "last_err_ptr", "last_err_len", "clear_last_error"]) {
    assert(typeof exp[k] === "function", `missing export: ${k}`);
  }
  assert(exp.translation_api_version() === 1, "translation_api_version mismatch");

  const service = allocStr(exp, mem, "custom");
  const source = allocStr(exp, mem, "auto");
  const target = allocStr(exp, mem, "ru");
  const text = allocStr(exp, mem, "hello");

  // 1st call: expect HTTP used.
  let outPtr = exp.translate_text(service.ptr, service.len, source.ptr, source.len, target.ptr, target.len, text.ptr, text.len);
  assert(outPtr !== 0, "translate_text returned null (error)");
  const outLen = exp.last_len();
  const out = readUtf8(mem, outPtr, outLen);
  exp.dealloc(outPtr, outLen);
  assert(out.includes("TRANSLATED_FROM_WASM"), `unexpected translation: ${out}`);
  assert(httpCalls === 1, `expected 1 http call, got ${httpCalls}`);

  // 2nd call with same params: expect cache hit, no new HTTP.
  outPtr = exp.translate_text(service.ptr, service.len, source.ptr, source.len, target.ptr, target.len, text.ptr, text.len);
  assert(outPtr !== 0, "translate_text returned null on second call (error)");
  const outLen2 = exp.last_len();
  const out2 = readUtf8(mem, outPtr, outLen2);
  exp.dealloc(outPtr, outLen2);
  assert(out2.includes("TRANSLATED_FROM_WASM"), `unexpected cached translation: ${out2}`);
  assert(httpCalls === 1, `expected cached call to avoid HTTP (still 1), got ${httpCalls}`);

  // Cleanup allocated inputs.
  for (const a of [service, source, target, text]) exp.dealloc(a.ptr, a.len);

  console.log("OK: translation_wasm smoke test passed");
}

main().catch((e) => {
  console.error("FAIL:", e && e.stack ? e.stack : String(e));
  process.exit(1);
});

