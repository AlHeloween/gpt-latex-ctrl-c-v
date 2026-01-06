(() => {
  const cof = (globalThis.__cof = globalThis.__cof || {});
  const storage = cof.storage;
  const browserApi = globalThis.browser || globalThis.chrome;

  if (!storage) {
    console.error("Storage module not loaded");
    return;
  }

  function showStatus(message, isError = false) {
    const statusEl = document.getElementById("status");
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.className = `status ${isError ? "error" : "success"}`;
    statusEl.style.display = "block";
    setTimeout(() => {
      statusEl.style.display = "none";
    }, 3000);
  }

  function normalizeFavoriteLanguages(targetLanguages) {
    const seen = new Set();
    const out = [];
    const list = Array.isArray(targetLanguages) ? targetLanguages : [];
    for (const codeRaw of list) {
      const code = String(codeRaw || "").trim();
      if (!code) continue;
      if (seen.has(code)) continue;
      seen.add(code);
      out.push(code);
      if (out.length >= 5) break;
    }
    return out;
  }

  function getLanguageLabel(code) {
    try {
      const displayNames = new Intl.DisplayNames([navigator.language || "en"], { type: "language" });
      const name = displayNames.of(code);
      if (name && name.toLowerCase() !== code.toLowerCase()) return `${name} (${code})`;
    } catch (e) {
      // Ignore and fall back to code
    }
    return code;
  }

  function renderActiveLanguageSelect(selectEl, favoriteCodes, selectedCode) {
    selectEl.textContent = "";

    if (!favoriteCodes.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No favorite languages set (open Advanced Settings...)";
      selectEl.appendChild(opt);
      selectEl.disabled = true;
      return { value: "" };
    }

    selectEl.disabled = false;
    for (const code of favoriteCodes) {
      const opt = document.createElement("option");
      opt.value = code;
      opt.textContent = getLanguageLabel(code);
      selectEl.appendChild(opt);
    }

    const valueToUse = favoriteCodes.includes(selectedCode) ? selectedCode : favoriteCodes[0];
    selectEl.value = valueToUse;
    return { value: valueToUse };
  }

  async function loadSettings() {
    try {
      const config = await storage.getConfig();
      document.getElementById("popupTranslationEnabled").checked = config.translation?.enabled || false;

      const selectEl = document.getElementById("popupActiveTargetLanguage");
      if (!selectEl) throw new Error("#popupActiveTargetLanguage not found");
      const serviceEl = document.getElementById("popupTranslationService");
      if (serviceEl) {
        serviceEl.value = config.translation?.service || "pollinations";
      }

      const favoriteCodes = normalizeFavoriteLanguages(config.translation?.targetLanguages);
      const defaultLanguage = String(config.translation?.defaultLanguage || "").trim();
      const rendered = renderActiveLanguageSelect(selectEl, favoriteCodes, defaultLanguage);

      if (favoriteCodes.length && rendered.value && rendered.value !== defaultLanguage) {
        config.translation = config.translation || {};
        config.translation.defaultLanguage = rendered.value;
        const ok = await storage.setConfig(config);
        if (!ok) showStatus("Error saving default language", true);
      }
    } catch (e) {
      console.error("Error loading settings:", e);
      showStatus("Error loading settings", true);
    }
  }

  async function saveTranslationEnabled() {
    try {
      const config = await storage.getConfig();
      config.translation = config.translation || {};
      config.translation.enabled = document.getElementById("popupTranslationEnabled").checked;
      const success = await storage.setConfig(config);
      if (success) {
        showStatus("Settings saved!");
      } else {
        showStatus("Error saving settings", true);
      }
    } catch (e) {
      console.error("Error saving settings:", e);
      showStatus("Error saving settings", true);
    }
  }

  async function saveActiveTargetLanguage() {
    try {
      const selectEl = document.getElementById("popupActiveTargetLanguage");
      const value = String(selectEl?.value || "").trim();
      if (!value) return;

      const config = await storage.getConfig();
      config.translation = config.translation || {};
      config.translation.defaultLanguage = value;
      const success = await storage.setConfig(config);
      if (success) {
        showStatus("Active language saved!");
      } else {
        showStatus("Error saving language", true);
      }
    } catch (e) {
      console.error("Error saving language:", e);
      showStatus("Error saving language", true);
    }
  }

  async function saveTranslationService() {
    try {
      const serviceEl = document.getElementById("popupTranslationService");
      const value = String(serviceEl?.value || "").trim();
      if (!value) return;
      const config = await storage.getConfig();
      config.translation = config.translation || {};
      config.translation.service = value;
      const success = await storage.setConfig(config);
      if (success) {
        showStatus("Translation model saved!");
      } else {
        showStatus("Error saving translation model", true);
      }
    } catch (e) {
      console.error("Error saving translation model:", e);
      showStatus("Error saving translation model", true);
    }
  }

  // Initialize
  document.addEventListener("DOMContentLoaded", () => {
    loadSettings();

    // Handle changes
    document.getElementById("popupTranslationEnabled").addEventListener("change", saveTranslationEnabled);
    document.getElementById("popupActiveTargetLanguage").addEventListener("change", saveActiveTargetLanguage);
    const serviceEl = document.getElementById("popupTranslationService");
    if (serviceEl) serviceEl.addEventListener("change", saveTranslationService);

    // Open options page
    document.getElementById("openOptions").addEventListener("click", (e) => {
      e.preventDefault();
      browserApi.runtime.openOptionsPage();
    });
  });
})();
