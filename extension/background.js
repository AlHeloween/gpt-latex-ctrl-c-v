const browserApi = globalThis.browser ?? globalThis.chrome;
const isChromeCallbackApi = !!globalThis.chrome && !globalThis.browser;

// Debug mode - set to false in production
const DEBUG = false;
const log = DEBUG
  ? console.log.bind(console, "[Copy as Office Format Background]")
  : () => {};
const logError = console.error.bind(
  console,
  "[Copy as Office Format Background]",
);

function chromeCall(fn, ...args) {
  return new Promise((resolve, reject) => {
    let done = false;
    const cb = (result) => {
      if (done) return;
      done = true;
      const err = browserApi?.runtime?.lastError;
      if (err) reject(err);
      else resolve(result);
    };
    try {
      const maybe = fn(...args, cb);
      if (maybe && typeof maybe.then === "function") {
        maybe.then(
          (r) => cb(r),
          (e) => {
            if (done) return;
            done = true;
            reject(e);
          },
        );
      }
    } catch (e) {
      if (done) return;
      done = true;
      reject(e);
    }
  });
}

async function writeClipboardViaAsyncApi(payload) {
  const mode = payload?.mode;
  const text = String(payload?.text || "");
  const html = String(payload?.html || "");

  if (mode === "text") {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    return false;
  }

  if (
    mode === "html" &&
    navigator?.clipboard?.write &&
    typeof ClipboardItem !== "undefined"
  ) {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      }),
    ]);
    return true;
  }

  return false;
}

async function ensureOffscreenDocument() {
  try {
    if (!browserApi?.offscreen?.createDocument) return false;

    // Prefer the dedicated MV3 API when available.
    if (typeof browserApi.offscreen.hasDocument === "function") {
      const has = await chromeCall(browserApi.offscreen.hasDocument);
      if (has) return true;
    } else if (typeof browserApi.runtime?.getContexts === "function") {
      const ctxs = await chromeCall(browserApi.runtime.getContexts, {
        contextTypes: ["OFFSCREEN_DOCUMENT"],
      });
      if (Array.isArray(ctxs) && ctxs.length > 0) return true;
    }

    const reason =
      browserApi.offscreen?.Reason?.CLIPBOARD ?? "CLIPBOARD";
    await chromeCall(browserApi.offscreen.createDocument, {
      url: "offscreen.html",
      reasons: [reason],
      justification: "Write Office-compatible HTML to clipboard",
    });
    return true;
  } catch (e) {
    logError("ensureOffscreenDocument failed:", e);
    return false;
  }
}

async function writeClipboardViaOffscreen(payload) {
  if (!browserApi?.offscreen?.createDocument) return { ok: false, error: "offscreen unavailable" };
  const ok = await ensureOffscreenDocument();
  if (!ok) return { ok: false, error: "offscreen createDocument failed", diag: clipboardDiag() };
  try {
    const r = await chromeCall(browserApi.runtime.sendMessage, {
      ...payload,
      type: "OFFSCREEN_WRITE_CLIPBOARD",
    });
    return r || { ok: false, error: "no response from offscreen" };
  } catch (e) {
    return { ok: false, error: String(e?.message || e), diag: clipboardDiag() };
  }
}

function clipboardDiag() {
  try {
    return {
      hasClipboard: !!navigator?.clipboard,
      hasWrite: !!navigator?.clipboard?.write,
      hasWriteText: !!navigator?.clipboard?.writeText,
      hasClipboardItem: typeof ClipboardItem !== "undefined",
      secureContext: typeof window !== "undefined" ? !!window.isSecureContext : null,
    };
  } catch (e) {
    logError("clipboardDiag failed:", e);
    return { diagError: true };
  }
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

function tabsSendMessage(tabId, message, options) {
  if (!isChromeCallbackApi)
    return browserApi.tabs.sendMessage(tabId, message, options);
  return chromePromise((cb) =>
    browserApi.tabs.sendMessage(tabId, message, options, cb),
  );
}

async function createContextMenu() {
  try {
    // Try to remove existing menu first (in case of reload)
    try {
      await contextMenusRemove("copy-office-format");
      await contextMenusRemove("copy-office-format-from-markdown");
      await contextMenusRemove("copy-as-markdown");
    } catch (e) {
      // Menu doesn't exist, that's fine
    }

    await contextMenusCreate({
      id: "copy-office-format",
      title: "Copy as Office Format",
      contexts: ["selection"],
    });

    await contextMenusCreate({
      id: "copy-office-format-from-markdown",
      title: "Copy as Office Format (Markdown selection)",
      contexts: ["selection"],
    });

    await contextMenusCreate({
      id: "copy-as-markdown",
      title: "Copy as Markdown",
      contexts: ["selection"],
    });
    log("Context menu created");
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
    sendResponse({ status: "ready", version: "0.2.0" });
    return true; // Keep channel open for async response
  }

  if (msg?.type === "WRITE_CLIPBOARD") {
    (async () => {
      try {
        if (await writeClipboardViaAsyncApi(msg)) {
          sendResponse({ ok: true, via: "async-clipboard" });
          return;
        }
        // MV3 service worker: use an offscreen document to write clipboard.
        if (browserApi?.offscreen?.createDocument) {
          const r = await writeClipboardViaOffscreen(msg);
          if (r?.ok) {
            sendResponse({ ok: true, via: r?.via || "offscreen" });
            return;
          }
          sendResponse({
            ok: false,
            error: r?.error || "Offscreen clipboard write failed",
            diag: r?.diag || clipboardDiag(),
          });
          return;
        }
        const d = clipboardDiag();
        sendResponse({
          ok: false,
          error: `Async clipboard unavailable in background (mode=${String(msg?.mode || "")})`,
          diag: d,
        });
      } catch (e) {
        sendResponse({
          ok: false,
          error: String(e?.message || e),
          diag: clipboardDiag(),
        });
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
    const opts =
      typeof info?.frameId === "number" ? { frameId: info.frameId } : undefined;
    tabsSendMessage(tab.id, { type: "COPY_OFFICE_FORMAT", mode: "html" }, opts)
      .then((response) => {
        log("✅ Message sent successfully to tab", tab.id);
        log("   Response:", response);
      })
      .catch((err) => {
        logError("❌ Cannot send message to tab", tab.id);
        logError("   Error:", err);
        logError("   Error name:", err.name);
        logError("   Error message:", err.message);
        logError("   Possible causes:");
        logError("   - Content script not loaded");
        logError("   - Tab URL not matching manifest patterns");
        logError("   - Extension not active on this page");
      });
  } else if (info.menuItemId === "copy-office-format-from-markdown") {
    if (!tab || !tab.id) return;
    const opts =
      typeof info?.frameId === "number" ? { frameId: info.frameId } : undefined;
    tabsSendMessage(
      tab.id,
      { type: "COPY_OFFICE_FORMAT", mode: "markdown" },
      opts,
    ).catch((e) => logError("COPY_OFFICE_FORMAT (markdown) failed:", e));
  } else if (info.menuItemId === "copy-as-markdown") {
    if (!tab || !tab.id) return;
    const opts =
      typeof info?.frameId === "number" ? { frameId: info.frameId } : undefined;
    tabsSendMessage(tab.id, { type: "COPY_AS_MARKDOWN" }, opts).catch((e) =>
      logError("COPY_AS_MARKDOWN failed:", e),
    );
  } else {
    log("⚠️ Unknown menu item clicked:", info.menuItemId);
  }
});
