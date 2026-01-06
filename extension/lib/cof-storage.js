(() => {
  const cof = (globalThis.__cof = globalThis.__cof || {});
  const core = cof.core || {};
  const browserApi = core.browserApi || globalThis.browser || globalThis.chrome;

  const STORAGE_KEY = "gptLatexCtrlCVConfig";
  const VERSION = "1.0.0";

  const DEFAULT_TARGET_LANGUAGES = ["en", "id", "ar", "zh-CN", "ru"];

  function _normalizeLangList(list, maxLen = 5) {
    const out = [];
    const seen = new Set();
    const items = Array.isArray(list) ? list : [];
    for (const raw of items) {
      const v = String(raw || "").trim();
      if (!v) continue;
      if (seen.has(v)) continue;
      seen.add(v);
      out.push(v);
      if (out.length >= maxLen) break;
    }
    while (out.length < maxLen) out.push("");
    return out;
  }

  function _normalizeTranslationConfig(translation) {
    const t = translation && typeof translation === "object" ? { ...translation } : {};
    const defaultLanguage = String(t.defaultLanguage || "").trim();
    let langs = _normalizeLangList(t.targetLanguages, 5);
    let nonEmpty = langs.filter((x) => !!x);

    if (!nonEmpty.length) {
      langs = [...DEFAULT_TARGET_LANGUAGES];
      nonEmpty = [...DEFAULT_TARGET_LANGUAGES];
    }

    let nextDefault = defaultLanguage;
    if (!nextDefault) nextDefault = nonEmpty[0] || "en";

    if (!nonEmpty.includes(nextDefault)) {
      // Ensure the active/default language is always one of the 5 "favorite" languages.
      nonEmpty = [nextDefault, ...nonEmpty].slice(0, 5);
      langs = _normalizeLangList(nonEmpty, 5);
    }

    t.defaultLanguage = nextDefault;
    t.targetLanguages = langs;
    return t;
  }

  const DEFAULT_CONFIG = {
    debug: {
      logsEnabled: false,
    },
    translation: {
      enabled: false,
      service: "pollinations",
      targetLanguages: [...DEFAULT_TARGET_LANGUAGES],
      translateFormulas: false,
      defaultLanguage: "en",
      timeoutMs: 60000,
      maxConcurrency: 6,
      // Experimental: translation WASM currently can't safely perform async HTTP from a synchronous WASM export.
      // Keep disabled unless/until a proper worker + Atomics/async bridge is implemented.
      useWasm: false,
    },
    keyboard: {
      interceptCopy: false,
    },
    apiKeys: {
      google: "",
      microsoft: "",
      chatgpt: "",
      gemini: "",
      pollinations: "",
      custom: "",
    },
    customApi: {
      endpoint: "",
      headers: {},
      method: "POST",
      payloadFormat: {},
    },
    backup: {
      version: VERSION,
      timestamp: Date.now(),
    },
  };

  function _applyRuntimeFlags(config) {
    try {
      const root = document?.documentElement;
      const ds = root?.dataset;
      if (!ds) return;
      const enabled = !!config?.debug?.logsEnabled;
      ds.copyOfficeFormatDebugLogs = enabled ? "true" : "false";
      globalThis.__cofDebugLogsEnabled = enabled;
    } catch (_e) {
      // ignore
    }
  }

  async function getConfig() {
    try {
      const result = await browserApi.storage.local.get(STORAGE_KEY);
      const config = result[STORAGE_KEY];
      if (!config) {
        const d = { ...DEFAULT_CONFIG };
        _applyRuntimeFlags(d);
        return d;
      }
      // Merge with defaults to handle missing keys
      const merged = {
        ...DEFAULT_CONFIG,
        ...config,
        debug: { ...DEFAULT_CONFIG.debug, ...(config.debug || {}) },
        translation: { ...DEFAULT_CONFIG.translation, ...(config.translation || {}) },
        keyboard: { ...DEFAULT_CONFIG.keyboard, ...(config.keyboard || {}) },
        apiKeys: { ...DEFAULT_CONFIG.apiKeys, ...(config.apiKeys || {}) },
        customApi: { ...DEFAULT_CONFIG.customApi, ...(config.customApi || {}) },
      };
      merged.translation = _normalizeTranslationConfig(merged.translation);
      _applyRuntimeFlags(merged);
      return merged;
    } catch (e) {
      console.error("[GPT LATEX Ctrl-C Ctrl-V] Storage getConfig error:", e);
      const d = { ...DEFAULT_CONFIG };
      _applyRuntimeFlags(d);
      return d;
    }
  }

  async function setConfig(config) {
    try {
      const normalized = {
        ...DEFAULT_CONFIG,
        ...(config || {}),
        debug: { ...DEFAULT_CONFIG.debug, ...((config && config.debug) || {}) },
        translation: _normalizeTranslationConfig(config?.translation),
        keyboard: { ...DEFAULT_CONFIG.keyboard, ...((config && config.keyboard) || {}) },
        apiKeys: { ...DEFAULT_CONFIG.apiKeys, ...((config && config.apiKeys) || {}) },
        customApi: { ...DEFAULT_CONFIG.customApi, ...((config && config.customApi) || {}) },
      };
      const fullConfig = {
        ...normalized,
        backup: {
          version: VERSION,
          timestamp: Date.now(),
        },
      };
      await browserApi.storage.local.set({ [STORAGE_KEY]: fullConfig });
      _applyRuntimeFlags(fullConfig);
      return true;
    } catch (e) {
      console.error("[GPT LATEX Ctrl-C Ctrl-V] Storage setConfig error:", e);
      return false;
    }
  }

  async function getApiKey(service) {
    try {
      const config = await getConfig();
      return config.apiKeys[service] || "";
    } catch (e) {
      console.error("[GPT LATEX Ctrl-C Ctrl-V] Storage getApiKey error:", e);
      return "";
    }
  }

  async function setApiKey(service, key) {
    try {
      const config = await getConfig();
      config.apiKeys[service] = String(key || "").trim();
      return await setConfig(config);
    } catch (e) {
      console.error("[GPT LATEX Ctrl-C Ctrl-V] Storage setApiKey error:", e);
      return false;
    }
  }

  async function exportConfig() {
    try {
      const config = await getConfig();
      const exportData = {
        ...config,
        backup: {
          version: VERSION,
          timestamp: Date.now(),
          exported: true,
        },
      };
      return JSON.stringify(exportData, null, 2);
    } catch (e) {
      console.error("[GPT LATEX Ctrl-C Ctrl-V] Storage exportConfig error:", e);
      return null;
    }
  }

  async function importConfig(jsonString) {
    try {
      const imported = JSON.parse(jsonString);
      if (!imported || typeof imported !== "object") {
        throw new Error("Invalid config format");
      }
      // Validate structure
      const config = {
        debug: imported.debug || DEFAULT_CONFIG.debug,
        translation: imported.translation || DEFAULT_CONFIG.translation,
        keyboard: imported.keyboard || DEFAULT_CONFIG.keyboard,
        apiKeys: imported.apiKeys || DEFAULT_CONFIG.apiKeys,
        customApi: imported.customApi || DEFAULT_CONFIG.customApi,
      };
      return await setConfig(config);
    } catch (e) {
      console.error("[GPT LATEX Ctrl-C Ctrl-V] Storage importConfig error:", e);
      return false;
    }
  }

  async function clearAll() {
    try {
      await browserApi.storage.local.remove(STORAGE_KEY);
      return true;
    } catch (e) {
      console.error("[GPT LATEX Ctrl-C Ctrl-V] Storage clearAll error:", e);
      return false;
    }
  }

  function validateConfig(config) {
    try {
      if (!config || typeof config !== "object") return false;
      if (!config.translation || typeof config.translation !== "object") return false;
      if (!config.keyboard || typeof config.keyboard !== "object") return false;
      if (!config.apiKeys || typeof config.apiKeys !== "object") return false;
      if (typeof config.translation.enabled !== "boolean") return false;
      if (typeof config.keyboard.interceptCopy !== "boolean") return false;
      return true;
    } catch (e) {
      return false;
    }
  }

  cof.storage = {
    getConfig,
    setConfig,
    getApiKey,
    setApiKey,
    exportConfig,
    importConfig,
    clearAll,
    validateConfig,
    DEFAULT_CONFIG,
  };

  // Keep runtime flags in sync when settings change (applies "on the fly").
  try {
    browserApi?.storage?.onChanged?.addListener?.((changes, areaName) => {
      try {
        if (areaName !== "local") return;
        const ch = changes && changes[STORAGE_KEY];
        if (!ch || !ch.newValue) return;
        _applyRuntimeFlags(ch.newValue);
      } catch (_e) {
        // ignore
      }
    });
  } catch (_e) {
    // ignore
  }
})();

