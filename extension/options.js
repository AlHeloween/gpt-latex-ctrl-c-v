(() => {
  const browserApi = globalThis.browser || globalThis.chrome;
  const storage = globalThis.__cof?.storage;
  let isLoading = false;
  let saveTimer = null;
  let lastLoadedConfig = null;
  let lastStatusMs = 0;

  if (!storage) {
    console.error("Storage module not loaded");
    return;
  }

  function showStatus(message, isError = false) {
    // Throttle very noisy "Saved" messages when auto-saving.
    const now = Date.now();
    if (!isError && now - lastStatusMs < 800) return;
    lastStatusMs = now;
    const statusEl = document.getElementById("status");
    statusEl.textContent = message;
    statusEl.className = `status ${isError ? "error" : "success"}`;
    statusEl.style.display = "block";
    setTimeout(() => {
      statusEl.style.display = "none";
    }, 3000);
  }

  function updateServiceVisibility(service) {
    const sections = {
      "google-free": null, // No API key section for free service
      google: document.getElementById("googleSection"),
      "microsoft-free": null, // No API key section for free service
      microsoft: document.getElementById("microsoftSection"),
      chatgpt: document.getElementById("chatgptSection"),
      gemini: document.getElementById("geminiSection"),
      pollinations: document.getElementById("pollinationsSection"),
      custom: document.getElementById("customSection"),
    };
    Object.keys(sections).forEach((key) => {
      if (sections[key]) {
        sections[key].classList.toggle("hidden", key !== service);
      }
    });
  }

  async function loadSettings() {
    try {
      isLoading = true;
      const config = await storage.getConfig();
      lastLoadedConfig = config;

      document.getElementById("translationEnabled").checked = config.translation?.enabled || false;
      document.getElementById("translationService").value = config.translation?.service || "pollinations";
      document.getElementById("translateFormulas").checked = config.translation?.translateFormulas || false;
      document.getElementById("defaultLanguage").value = config.translation?.defaultLanguage || "en";
      document.getElementById("interceptCopy").checked = config.keyboard?.interceptCopy || false;
      document.getElementById("debugLogsEnabled").checked = config.debug?.logsEnabled || false;

      const targetLangs = config.translation?.targetLanguages || ["", "", "", "", ""];
      for (let i = 0; i < 5; i++) {
        const el = document.getElementById(`targetLanguage${i + 1}`);
        if (el) el.value = targetLangs[i] || "";
      }

      document.getElementById("apiKeyGoogle").value = config.apiKeys?.google || "";
      document.getElementById("apiKeyMicrosoft").value = config.apiKeys?.microsoft || "";
      document.getElementById("apiKeyChatGPT").value = config.apiKeys?.chatgpt || "";
      document.getElementById("apiKeyGemini").value = config.apiKeys?.gemini || "";
      document.getElementById("apiKeyPollinations").value = config.apiKeys?.pollinations || "";
      document.getElementById("apiKeyCustom").value = config.apiKeys?.custom || "";

      // Pollinations endpoint is stored in customApi.endpoint when service is pollinations
      const pollEndpoint = config.translation?.service === "pollinations" 
        ? (config.customApi?.endpoint || "https://text.pollinations.ai/")
        : "https://text.pollinations.ai/";
      document.getElementById("pollinationsEndpoint").value = pollEndpoint;
      document.getElementById("microsoftRegion").value = config.customApi?.region || "";
      document.getElementById("customEndpoint").value = config.customApi?.endpoint || "";
      document.getElementById("customMethod").value = config.customApi?.method || "POST";
      try {
        document.getElementById("customHeaders").value = JSON.stringify(config.customApi?.headers || {}, null, 2);
      } catch (e) {
        document.getElementById("customHeaders").value = "{}";
      }

      updateServiceVisibility(config.translation?.service || "pollinations");
    } catch (e) {
      console.error("Error loading settings:", e);
      showStatus("Error loading settings", true);
    } finally {
      isLoading = false;
    }
  }

  function buildConfigFromForm() {
    const base = lastLoadedConfig && typeof lastLoadedConfig === "object" ? lastLoadedConfig : {};
    const service = document.getElementById("translationService").value;
    const pollinationsEndpoint = document.getElementById("pollinationsEndpoint").value;
    const customEndpoint = document.getElementById("customEndpoint").value;
    return {
      ...base,
      debug: {
        ...(base.debug || {}),
        logsEnabled: document.getElementById("debugLogsEnabled").checked,
      },
      translation: {
        ...(base.translation || {}),
        enabled: document.getElementById("translationEnabled").checked,
        service,
        translateFormulas: document.getElementById("translateFormulas").checked,
        defaultLanguage: document.getElementById("defaultLanguage").value,
        targetLanguages: [
          document.getElementById("targetLanguage1").value,
          document.getElementById("targetLanguage2").value,
          document.getElementById("targetLanguage3").value,
          document.getElementById("targetLanguage4").value,
          document.getElementById("targetLanguage5").value,
        ],
      },
      keyboard: {
        ...(base.keyboard || {}),
        interceptCopy: document.getElementById("interceptCopy").checked,
      },
      apiKeys: {
        ...(base.apiKeys || {}),
        google: document.getElementById("apiKeyGoogle").value,
        microsoft: document.getElementById("apiKeyMicrosoft").value,
        chatgpt: document.getElementById("apiKeyChatGPT").value,
        gemini: document.getElementById("apiKeyGemini").value,
        pollinations: document.getElementById("apiKeyPollinations").value,
        custom: document.getElementById("apiKeyCustom").value,
      },
      customApi: {
        ...(base.customApi || {}),
        // Keep endpoint around even when switching services; active service decides usage.
        endpoint:
          service === "pollinations"
            ? pollinationsEndpoint
            : service === "custom"
              ? customEndpoint
              : (base.customApi || {}).endpoint || "",
        region: document.getElementById("microsoftRegion").value,
        method: document.getElementById("customMethod").value,
        headers: (() => {
          try {
            return JSON.parse(document.getElementById("customHeaders").value || "{}");
          } catch (e) {
            return {};
          }
        })(),
      },
    };
  }

  async function saveSettings() {
    try {
      const config = buildConfigFromForm();

      const success = await storage.setConfig(config);
      if (success) {
        await loadSettings();
        showStatus("Saved");
      } else {
        showStatus("Save failed", true);
      }
    } catch (e) {
      console.error("Error saving settings:", e);
      showStatus("Save failed", true);
    }
  }

  function scheduleSave() {
    if (isLoading) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveSettings();
    }, 350);
  }

  async function resetSettings() {
    if (!confirm("Reset all settings to defaults? This will clear all API keys.")) {
      return;
    }
    try {
      await storage.clearAll();
      await loadSettings();
      showStatus("Settings reset to defaults");
    } catch (e) {
      console.error("Error resetting settings:", e);
      showStatus("Error resetting settings", true);
    }
  }

  async function exportSettings() {
    try {
      const json = await storage.exportConfig();
      if (!json) {
        showStatus("Error exporting configuration", true);
        return;
      }
      const name = `gpt-latex-ctrl-c-v-config-${Date.now()}.json`;
      if (typeof window.showSaveFilePicker === "function") {
        const handle = await window.showSaveFilePicker({
          suggestedName: name,
          types: [
            {
              description: "JSON",
              accept: { "application/json": [".json"] },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(json);
        await writable.close();
        showStatus("Configuration saved");
        return;
      }

      // Fallback: use downloads API with saveAs (real file dialog) when available.
      if (browserApi?.downloads?.download) {
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        try {
          const dl = browserApi.downloads.download;
          // Promise-based (Firefox) or callback-based (Chromium).
          const id = await new Promise((resolve, reject) => {
            try {
              const r = dl(
                { url, filename: name, saveAs: true },
                (downloadId) => {
                  const err = browserApi.runtime?.lastError;
                  if (err) reject(new Error(err.message || String(err)));
                  else resolve(downloadId);
                }
              );
              // Firefox returns a Promise.
              if (r && typeof r.then === "function") {
                r.then(resolve, reject);
              }
            } catch (e) {
              reject(e);
            }
          });
          showStatus(`Configuration saved (download ${id})`);
          return;
        } finally {
          URL.revokeObjectURL(url);
        }
      }

      // Last resort: download attribute (may prompt depending on browser settings).
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showStatus("Configuration exported");
    } catch (e) {
      console.error("Error exporting settings:", e);
      showStatus("Error exporting configuration", true);
    }
  }

  async function importSettings(file) {
    try {
      const text = await file.text();
      const success = await storage.importConfig(text);
      if (success) {
        await loadSettings();
        showStatus("Configuration imported successfully!");
      } else {
        showStatus("Error importing configuration", true);
      }
    } catch (e) {
      console.error("Error importing settings:", e);
      showStatus("Error importing configuration", true);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    loadSettings();

    document.getElementById("resetBtn").addEventListener("click", resetSettings);
    document.getElementById("exportBtn").addEventListener("click", exportSettings);
    document.getElementById("importBtn").addEventListener("click", () => {
      document.getElementById("importFile").click();
    });
    document.getElementById("importFile").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) {
        importSettings(file);
        e.target.value = "";
      }
    });

    document.getElementById("translationService").addEventListener("change", (e) => {
      updateServiceVisibility(e.target.value);
      scheduleSave();
    });

    // Auto-apply all settings on change (no explicit "Save Settings" button).
    for (const el of document.querySelectorAll("input, select, textarea")) {
      if (!el || !el.id) continue;
      if (el.id === "importFile") continue;
      if (el.id === "exportBtn" || el.id === "importBtn" || el.id === "resetBtn") continue;
      el.addEventListener("change", scheduleSave);
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
        el.addEventListener("input", scheduleSave);
      }
    }
  });
})();

