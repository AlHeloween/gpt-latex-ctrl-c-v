(() => {
  const cof = (globalThis.__cof = globalThis.__cof || {});
  const diag = cof.diag || (() => {});
  const core = cof.core || {};

  let wasmP = null;
  async function load() {
    if (wasmP) return wasmP;
    wasmP = (async () => {
      const browserApi = core.browserApi;
      if (!browserApi?.runtime?.getURL) throw new Error("runtime.getURL missing");
      const url = browserApi.runtime.getURL("wasm/tex_to_mathml.wasm");
      const r = await fetch(url);
      if (!r.ok) throw new Error(`wasm fetch failed: ${r.status}`);
      const { instance } = await WebAssembly.instantiate(await r.arrayBuffer(), {});
      const e = instance.exports || {};
      if (e.api_version && e.api_version() !== 3)
        throw new Error(`wasm api_version mismatch: ${e.api_version()}`);
      return { e, mem: e.memory };
    })();
    return wasmP;
  }

  function lastError(w) {
    try {
      const e = w.e;
      const ptr = e.last_err_ptr();
      const len = e.last_err_len();
      if (!ptr || !len) return "wasm error";
      const msg = new TextDecoder("utf-8").decode(
        new Uint8Array(w.mem.buffer, ptr, len),
      );
      e.dealloc(ptr, len);
      e.clear_last_error();
      return msg || "wasm error";
    } catch (e) {
      diag("copyOfficeFormatNonFatalError", e);
      return "wasm error";
    }
  }

  function call1(w, fn, s) {
    const e = w.e;
    const bytes = new TextEncoder().encode(String(s || ""));
    const ptr = e.alloc(bytes.length);
    new Uint8Array(w.mem.buffer, ptr, bytes.length).set(bytes);
    const outPtr = e[fn](ptr, bytes.length);
    e.dealloc(ptr, bytes.length);
    if (!outPtr) throw new Error(lastError(w));
    const outLen = e.last_len();
    const out = new TextDecoder("utf-8").decode(
      new Uint8Array(w.mem.buffer, outPtr, outLen),
    );
    e.dealloc(outPtr, outLen);
    return out;
  }

  function call2(w, fn, a, b) {
    const e = w.e;
    const enc = new TextEncoder();
    const aBytes = enc.encode(String(a || ""));
    const bBytes = enc.encode(String(b || ""));
    const aPtr = e.alloc(aBytes.length);
    const bPtr = e.alloc(bBytes.length);
    new Uint8Array(w.mem.buffer, aPtr, aBytes.length).set(aBytes);
    new Uint8Array(w.mem.buffer, bPtr, bBytes.length).set(bBytes);
    const outPtr = e[fn](aPtr, aBytes.length, bPtr, bBytes.length);
    e.dealloc(aPtr, aBytes.length);
    e.dealloc(bPtr, bBytes.length);
    if (!outPtr) throw new Error(lastError(w));
    const outLen = e.last_len();
    const out = new TextDecoder("utf-8").decode(
      new Uint8Array(w.mem.buffer, outPtr, outLen),
    );
    e.dealloc(outPtr, outLen);
    return out;
  }

  function call1Binary(w, fn, s) {
    const e = w.e;
    const bytes = new TextEncoder().encode(String(s || ""));
    const ptr = e.alloc(bytes.length);
    new Uint8Array(w.mem.buffer, ptr, bytes.length).set(bytes);
    const outPtr = e[fn](ptr, bytes.length);
    e.dealloc(ptr, bytes.length);
    if (!outPtr) throw new Error(lastError(w));
    const outLen = e.last_len();
    const out = new Uint8Array(w.mem.buffer, outPtr, outLen);
    const result = new Uint8Array(out); // Copy the data
    e.dealloc(outPtr, outLen);
    return result;
  }

  void load().catch((e) =>
    diag("copyOfficeFormatWasmPreloadError", e?.message || e || ""),
  );

  cof.wasm = { load, call1, call2, call1Binary };
})();
