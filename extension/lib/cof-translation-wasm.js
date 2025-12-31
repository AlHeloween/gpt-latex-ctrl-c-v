(() => {
  const cof = (globalThis.__cof = globalThis.__cof || {});
  const diag = cof.diag || (() => {});
  const core = cof.core || {};

  let wasmP = null;
  let wasmModule = null;
  let httpRequestCallbackId = 0;
  const httpRequestCallbacks = new Map();
  let cacheRequestCallbackId = 0;
  const cacheRequestCallbacks = new Map();

  // HTTP bridge: Make HTTP request from JavaScript
  async function httpRequest(url, method, headers, body) {
    try {
      const options = {
        method: method || "GET",
        headers: headers || {},
      };
      if (body) {
        options.body = body;
      }
      const response = await fetch(url, options);
      const responseText = await response.text();
      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        text: responseText,
        headers: Object.fromEntries(response.headers.entries()),
      };
    } catch (e) {
      diag("translationHttpRequestError", String(e?.message || e || ""));
      return {
        ok: false,
        status: 0,
        statusText: String(e?.message || e || "Network error"),
        text: "",
        headers: {},
      };
    }
  }

  // Cache bridge: Get from IndexedDB
  async function cacheGet(key) {
    try {
      const dbName = "translation_cache";
      const storeName = "translations";
      
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onerror = () => {
          diag("translationCacheGetError", "IndexedDB open failed");
          resolve(null);
        };
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction([storeName], "readonly");
          const store = transaction.objectStore(storeName);
          const getRequest = store.get(key);
          getRequest.onsuccess = () => {
            resolve(getRequest.result || null);
          };
          getRequest.onerror = () => {
            diag("translationCacheGetError", "Store get failed");
            resolve(null);
          };
        };
        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName);
          }
        };
      });
    } catch (e) {
      diag("translationCacheGetError", String(e?.message || e || ""));
      return null;
    }
  }

  // Cache bridge: Set to IndexedDB
  async function cacheSet(key, value) {
    try {
      const dbName = "translation_cache";
      const storeName = "translations";
      
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onerror = () => {
          diag("translationCacheSetError", "IndexedDB open failed");
          resolve(false);
        };
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction([storeName], "readwrite");
          const store = transaction.objectStore(storeName);
          const putRequest = store.put(value, key);
          putRequest.onsuccess = () => {
            resolve(true);
          };
          putRequest.onerror = () => {
            diag("translationCacheSetError", "Store put failed");
            resolve(false);
          };
        };
        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName);
          }
        };
      });
    } catch (e) {
      diag("translationCacheSetError", String(e?.message || e || ""));
      return false;
    }
  }

  // WASM import: HTTP request (async callback pattern)
  function wasmHttpRequest(urlPtr, urlLen, methodPtr, methodLen, headersPtr, headersLen, bodyPtr, bodyLen, callbackId) {
    const w = wasmModule;
    if (!w) {
      diag("translationWasmHttpRequestError", "WASM module not loaded");
      return;
    }
    
    try {
      const url = new TextDecoder("utf-8").decode(
        new Uint8Array(w.mem.buffer, urlPtr, urlLen),
      );
      const method = methodPtr ? new TextDecoder("utf-8").decode(
        new Uint8Array(w.mem.buffer, methodPtr, methodLen),
      ) : "GET";
      const headersStr = headersPtr ? new TextDecoder("utf-8").decode(
        new Uint8Array(w.mem.buffer, headersPtr, headersLen),
      ) : "{}";
      const body = bodyPtr ? new TextDecoder("utf-8").decode(
        new Uint8Array(w.mem.buffer, bodyPtr, bodyLen),
      ) : null;
      
      let headers = {};
      try {
        headers = JSON.parse(headersStr);
      } catch (e) {
        diag("translationWasmHttpRequestHeaderParseError", String(e));
      }
      
      httpRequest(url, method, headers, body).then((result) => {
        httpRequestCallbacks.set(callbackId, result);
        // Signal completion (WASM will poll or we'll use a callback mechanism)
        if (w.e.http_request_complete) {
          w.e.http_request_complete(callbackId);
        }
      }).catch((e) => {
        diag("translationWasmHttpRequestError", String(e));
        httpRequestCallbacks.set(callbackId, {
          ok: false,
          status: 0,
          statusText: String(e?.message || e || "Network error"),
          text: "",
          headers: {},
        });
        if (w.e.http_request_complete) {
          w.e.http_request_complete(callbackId);
        }
      });
    } catch (e) {
      diag("translationWasmHttpRequestError", String(e));
    }
  }

  // WASM import: Get HTTP request result
  function wasmHttpRequestGetResult(callbackId, resultPtr, resultLenPtr) {
    const w = wasmModule;
    if (!w) return 0;
    
    const result = httpRequestCallbacks.get(callbackId);
    if (!result) return 0;
    
    try {
      const resultJson = JSON.stringify(result);
      const bytes = new TextEncoder().encode(resultJson);
      const ptr = w.e.alloc(bytes.length);
      new Uint8Array(w.mem.buffer, ptr, bytes.length).set(bytes);
      new Uint32Array(w.mem.buffer, resultLenPtr, 1)[0] = bytes.length;
      httpRequestCallbacks.delete(callbackId);
      return ptr;
    } catch (e) {
      diag("translationWasmHttpRequestGetResultError", String(e));
      return 0;
    }
  }

  // WASM import: Cache get (async callback pattern)
  function wasmCacheGet(keyPtr, keyLen, callbackId) {
    const w = wasmModule;
    if (!w) {
      diag("translationWasmCacheGetError", "WASM module not loaded");
      return;
    }
    
    try {
      const key = new TextDecoder("utf-8").decode(
        new Uint8Array(w.mem.buffer, keyPtr, keyLen),
      );
      
      cacheGet(key).then((result) => {
        cacheRequestCallbacks.set(callbackId, result);
        if (w.e.cache_request_complete) {
          w.e.cache_request_complete(callbackId);
        }
      }).catch((e) => {
        diag("translationWasmCacheGetError", String(e));
        cacheRequestCallbacks.set(callbackId, null);
        if (w.e.cache_request_complete) {
          w.e.cache_request_complete(callbackId);
        }
      });
    } catch (e) {
      diag("translationWasmCacheGetError", String(e));
    }
  }

  // WASM import: Get cache result
  function wasmCacheGetResult(callbackId, resultPtr, resultLenPtr) {
    const w = wasmModule;
    if (!w) return 0;
    
    const result = cacheRequestCallbacks.get(callbackId);
    if (result === undefined) return 0;
    
    try {
      if (result === null) {
        new Uint32Array(w.mem.buffer, resultLenPtr, 1)[0] = 0;
        cacheRequestCallbacks.delete(callbackId);
        return 0;
      }
      const resultJson = JSON.stringify(result);
      const bytes = new TextEncoder().encode(resultJson);
      const ptr = w.e.alloc(bytes.length);
      new Uint8Array(w.mem.buffer, ptr, bytes.length).set(bytes);
      new Uint32Array(w.mem.buffer, resultLenPtr, 1)[0] = bytes.length;
      cacheRequestCallbacks.delete(callbackId);
      return ptr;
    } catch (e) {
      diag("translationWasmCacheGetResultError", String(e));
      return 0;
    }
  }

  // WASM import: Cache set (synchronous wrapper - actual operation is async but we return immediately)
  function wasmCacheSet(keyPtr, keyLen, valuePtr, valueLen) {
    const w = wasmModule;
    if (!w) return 0;
    
    try {
      const key = new TextDecoder("utf-8").decode(
        new Uint8Array(w.mem.buffer, keyPtr, keyLen),
      );
      const valueStr = new TextDecoder("utf-8").decode(
        new Uint8Array(w.mem.buffer, valuePtr, valueLen),
      );
      let value;
      try {
        value = JSON.parse(valueStr);
      } catch (e) {
        value = { translated_text: valueStr, detected_language: "" };
      }
      
      // Fire and forget - cache writes are best effort
      cacheSet(key, value).catch((e) => {
        diag("translationWasmCacheSetError", String(e));
      });
      
      return 1; // Return success immediately (async operation continues in background)
    } catch (e) {
      diag("translationWasmCacheSetError", String(e));
      return 0;
    }
  }

  async function load() {
    if (wasmP) return wasmP;
    wasmP = (async () => {
      const browserApi = core.browserApi;
      if (!browserApi?.runtime?.getURL) throw new Error("runtime.getURL missing");
      const url = browserApi.runtime.getURL("wasm/translation_wasm.wasm");
      const r = await fetch(url);
      if (!r.ok) throw new Error(`wasm fetch failed: ${r.status}`);
      
      // Import functions for HTTP, IndexedDB, etc.
      const imports = {
        env: {
          http_request: wasmHttpRequest,
          http_request_get_result: wasmHttpRequestGetResult,
          cache_get: wasmCacheGet,
          cache_get_result: wasmCacheGetResult,
          cache_set: wasmCacheSet,
        },
      };
      
      const { instance } = await WebAssembly.instantiate(await r.arrayBuffer(), imports);
      
      const e = instance.exports || {};
      if (e.translation_api_version && e.translation_api_version() !== 1) {
        throw new Error(`translation wasm api_version mismatch: ${e.translation_api_version()}`);
      }
      
      wasmModule = { e, mem: e.memory };
      return wasmModule;
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
      diag("translationWasmError", e);
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

  // Translation functions - call Rust WASM module
  // Rust now handles HTTP requests internally via bridge functions
  async function translateText(service, sourceLang, targetLang, text) {
    const w = await load();
    const e = w.e;
    
    try {
      // Call Rust translate_text which handles HTTP and cache internally
      const serviceBytes = new TextEncoder().encode(service);
      const sourceLangBytes = new TextEncoder().encode(sourceLang);
      const targetLangBytes = new TextEncoder().encode(targetLang);
      const textBytes = new TextEncoder().encode(text);
      
      const servicePtr = e.alloc(serviceBytes.length);
      const sourceLangPtr = e.alloc(sourceLangBytes.length);
      const targetLangPtr = e.alloc(targetLangBytes.length);
      const textPtr = e.alloc(textBytes.length);
      
      new Uint8Array(w.mem.buffer, servicePtr, serviceBytes.length).set(serviceBytes);
      new Uint8Array(w.mem.buffer, sourceLangPtr, sourceLangBytes.length).set(sourceLangBytes);
      new Uint8Array(w.mem.buffer, targetLangPtr, targetLangBytes.length).set(targetLangBytes);
      new Uint8Array(w.mem.buffer, textPtr, textBytes.length).set(textBytes);
      
      const resultPtr = e.translate_text(
        servicePtr, serviceBytes.length,
        sourceLangPtr, sourceLangBytes.length,
        targetLangPtr, targetLangBytes.length,
        textPtr, textBytes.length,
      );
      
      e.dealloc(servicePtr, serviceBytes.length);
      e.dealloc(sourceLangPtr, sourceLangBytes.length);
      e.dealloc(targetLangPtr, targetLangBytes.length);
      e.dealloc(textPtr, textBytes.length);
      
      if (!resultPtr) {
        throw new Error(lastError(w));
      }
      
      const resultLen = e.last_len();
      const result = new TextDecoder("utf-8").decode(
        new Uint8Array(w.mem.buffer, resultPtr, resultLen),
      );
      e.dealloc(resultPtr, resultLen);
      
      return result;
    } catch (e) {
      diag("translationWasmTranslateTextError", String(e?.message || e || ""));
      throw e;
    }
  }

  async function translateHtml(service, sourceLang, targetLang, html, dontSort) {
    // For now, treat HTML as text (HTML-aware translation can be added later)
    return translateText(service, sourceLang, targetLang, html);
  }

  void load().catch((e) =>
    diag("translationWasmPreloadError", e?.message || e || ""),
  );

  cof.translationWasm = {
    load,
    translateText,
    translateHtml,
    setApiKey: (service, key) => {
      load().then((w) => {
        const e = w.e;
        const serviceBytes = new TextEncoder().encode(service);
        const keyBytes = new TextEncoder().encode(key);
        const servicePtr = e.alloc(serviceBytes.length);
        const keyPtr = e.alloc(keyBytes.length);
        new Uint8Array(w.mem.buffer, servicePtr, serviceBytes.length).set(serviceBytes);
        new Uint8Array(w.mem.buffer, keyPtr, keyBytes.length).set(keyBytes);
        e.set_api_key(servicePtr, serviceBytes.length, keyPtr, keyBytes.length);
        e.dealloc(servicePtr, serviceBytes.length);
        e.dealloc(keyPtr, keyBytes.length);
      });
    },
    setCustomService: (config) => {
      load().then((w) => {
        const e = w.e;
        const configStr = JSON.stringify(config);
        const configBytes = new TextEncoder().encode(configStr);
        const configPtr = e.alloc(configBytes.length);
        new Uint8Array(w.mem.buffer, configPtr, configBytes.length).set(configBytes);
        e.set_custom_service(configPtr, configBytes.length);
        e.dealloc(configPtr, configBytes.length);
      });
    },
    clearCache: () => {
      load().then((w) => {
        w.e.clear_translation_cache();
      });
    },
  };
})();

