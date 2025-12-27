const browserApi = globalThis.browser ?? globalThis.chrome;
const isChromeCallbackApi = !!globalThis.chrome && !globalThis.browser;

// Debug mode - set to false in production
const DEBUG = false;
const log = DEBUG ? console.log.bind(console, "[Copy as Office Format Background]") : () => {};
const logError = console.error.bind(console, "[Copy as Office Format Background]");

let _mathJaxReadyPromise = null;

async function ensureBackgroundMathJax() {
  // MV3 service workers (Chromium test build) have no DOM; skip deterministically.
  if (typeof document === "undefined") {
    return { ok: false, error: "no-dom" };
  }

  if (_mathJaxReadyPromise) return _mathJaxReadyPromise;

  _mathJaxReadyPromise = new Promise((resolve, reject) => {
    try {
      if (globalThis.MathJax && typeof globalThis.MathJax.tex2mmlPromise === "function") {
        return resolve(true);
      }

      const src = browserApi.runtime.getURL("mathjax/tex-mml-chtml.js");
      const already = document.querySelector(`script[src="${src}"]`);
      if (already) {
        // Wait a bit for it to initialize.
        const poll = () => {
          if (globalThis.MathJax && typeof globalThis.MathJax.tex2mmlPromise === "function") return resolve(true);
          setTimeout(poll, 50);
        };
        return poll();
      }

      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = () => resolve(true);
      s.onerror = () => reject(new Error("Failed to load MathJax in background"));
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {
      reject(e);
    }
  })
    .then(async () => {
      // Ensure tex2mmlPromise exists (MathJax can take a moment after onload).
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        if (globalThis.MathJax && typeof globalThis.MathJax.tex2mmlPromise === "function") return true;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error("MathJax loaded but tex2mmlPromise not available");
    })
    .catch((e) => {
      _mathJaxReadyPromise = null; // allow retry
      throw e;
    });

  return _mathJaxReadyPromise;
}

function chromePromise(callWithCallback) {
  return new Promise((resolve, reject) => {
    try {
      callWithCallback((result) => {
        const err = browserApi?.runtime?.lastError;
        if (err) reject(err);
        else resolve(result);
      });
    } catch (e) {
      reject(e);
    }
  });
}

function contextMenusRemove(id) {
  if (!isChromeCallbackApi) return browserApi.contextMenus.remove(id);
  return chromePromise((cb) => browserApi.contextMenus.remove(id, cb));
}

function contextMenusCreate(options) {
  if (!isChromeCallbackApi) return browserApi.contextMenus.create(options);
  return chromePromise((cb) => browserApi.contextMenus.create(options, cb));
}

function tabsSendMessage(tabId, message) {
  if (!isChromeCallbackApi) return browserApi.tabs.sendMessage(tabId, message);
  return chromePromise((cb) => browserApi.tabs.sendMessage(tabId, message, cb));
}

async function createContextMenu() {
  try {
    // Try to remove existing menu first (in case of reload)
    try {
      await contextMenusRemove("copy-office-format");
    } catch (e) {
      // Menu doesn't exist, that's fine
    }
    
    await contextMenusCreate({
      id: "copy-office-format",
      title: "Copy as Office Format",
      contexts: ["selection"]
    });
    log("Context menu created");

    // Best-effort warm-up so first LaTeX conversion doesn't pay the full load cost (Firefox MV2 background page).
    try {
      ensureBackgroundMathJax().catch(() => {});
    } catch {
      // ignore
    }
  } catch (err) {
    logError("Failed to create context menu:", err);
  }
}

browserApi.runtime.onInstalled.addListener(createContextMenu);
browserApi.runtime.onStartup.addListener(createContextMenu);

browserApi.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "EXTENSION_READY") {
    if (DEBUG) {
      log("Extension ready notification received from content script");
    }
    sendResponse({status: 'ready', version: '0.2.0'});
    return true; // Keep channel open for async response
  }

  if (msg.type === "LATEX_TO_MATHML") {
    (async () => {
      try {
        if (!msg || typeof msg.latex !== "string") {
          return sendResponse({ ok: false, error: "invalid-args" });
        }
        const ready = await ensureBackgroundMathJax();
        if (ready && ready.ok === false) {
          return sendResponse({ ok: false, error: ready.error || "unsupported" });
        }
        const display = !!msg.display;
        const mathml = await globalThis.MathJax.tex2mmlPromise(msg.latex, { display });
        sendResponse({ ok: true, mathml: String(mathml) });
      } catch (e) {
        sendResponse({ ok: false, error: e && e.message ? e.message : String(e) });
      }
    })();
    return true;
  }

  return false;
});

browserApi.contextMenus.onClicked.addListener((info, tab) => {
  log("🔵 Context menu clicked!");
  log("   Menu item ID:", info.menuItemId);
  log("   Tab ID:", tab ? tab.id : "NO TAB");
  log("   Tab URL:", tab ? tab.url : "NO TAB");
  
  if (info.menuItemId === "copy-office-format") {
    // Check if tab is valid before sending message
    if (!tab || !tab.id) {
      logError("❌ Invalid tab - cannot send message");
      return;
    }
    
    log("📤 Sending COPY_OFFICE_FORMAT message to tab", tab.id);
    tabsSendMessage(tab.id, { type: "COPY_OFFICE_FORMAT" }).then((response) => {
      log("✅ Message sent successfully to tab", tab.id);
      log("   Response:", response);
    }).catch((err) => {
      logError("❌ Cannot send message to tab", tab.id);
      logError("   Error:", err);
      logError("   Error name:", err.name);
      logError("   Error message:", err.message);
      logError("   Possible causes:");
      logError("   - Content script not loaded");
      logError("   - Tab URL not matching manifest patterns");
      logError("   - Extension not active on this page");
    });
  } else {
    log("⚠️ Unknown menu item clicked:", info.menuItemId);
  }
});
