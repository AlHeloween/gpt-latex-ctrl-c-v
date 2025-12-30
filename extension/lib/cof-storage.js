(() => {
  const cof = (globalThis.__cof = globalThis.__cof || {});
  const core = cof.core || {};
  const browserApi = core.browserApi || globalThis.browser || globalThis.chrome;

  const STORAGE_KEY = "gptLatexCtrlCVConfig";
  const VERSION = "1.0.0";

  const DEFAULT_CONFIG = {
    translation: {
      enabled: false,
      service: "pollinations",
      targetLanguages: ["", "", "", "", ""],
      translateFormulas: false,
      defaultLanguage: "en",
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

  async function getConfig() {
    try {
      const result = await browserApi.storage.local.get(STORAGE_KEY);
      const config = result[STORAGE_KEY];
      if (!config) {
        return { ...DEFAULT_CONFIG };
      }
      // Merge with defaults to handle missing keys
      return {
        ...DEFAULT_CONFIG,
        ...config,
        translation: { ...DEFAULT_CONFIG.translation, ...(config.translation || {}) },
        keyboard: { ...DEFAULT_CONFIG.keyboard, ...(config.keyboard || {}) },
        apiKeys: { ...DEFAULT_CONFIG.apiKeys, ...(config.apiKeys || {}) },
        customApi: { ...DEFAULT_CONFIG.customApi, ...(config.customApi || {}) },
      };
    } catch (e) {
      console.error("[GPT LATEX Ctrl-C Ctrl-V] Storage getConfig error:", e);
      return { ...DEFAULT_CONFIG };
    }
  }

  async function setConfig(config) {
    try {
      const fullConfig = {
        ...config,
        backup: {
          version: VERSION,
          timestamp: Date.now(),
        },
      };
      await browserApi.storage.local.set({ [STORAGE_KEY]: fullConfig });
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
})();

