/* Offscreen clipboard writer for Chromium MV3 service workers.
 *
 * The MV3 background service worker cannot reliably access the async clipboard API.
 * This offscreen document exists solely to perform clipboard writes in an inspectable way.
 */

const browserApi = globalThis.browser ?? globalThis.chrome;

function clipboardDiag() {
  try {
    return {
      hasClipboard: !!navigator?.clipboard,
      hasWrite: !!navigator?.clipboard?.write,
      hasWriteText: !!navigator?.clipboard?.writeText,
      hasClipboardItem: typeof ClipboardItem !== "undefined",
      secureContext: typeof window !== "undefined" ? !!window.isSecureContext : null,
    };
  } catch {
    return { diagError: true };
  }
}

async function writeClipboard(payload) {
  const mode = payload?.mode;
  const text = String(payload?.text || "");
  const html = String(payload?.html || "");

  if (mode === "text") {
    if (!navigator?.clipboard?.writeText) return { ok: false, error: "writeText unavailable", diag: clipboardDiag() };
    await navigator.clipboard.writeText(text);
    return { ok: true, via: "offscreen" };
  }

  if (mode === "html") {
    if (!navigator?.clipboard?.write || typeof ClipboardItem === "undefined")
      return { ok: false, error: "write/ClipboardItem unavailable", diag: clipboardDiag() };
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      }),
    ]);
    return { ok: true, via: "offscreen" };
  }

  return { ok: false, error: `unsupported mode=${String(mode || "")}`, diag: clipboardDiag() };
}

browserApi.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "OFFSCREEN_WRITE_CLIPBOARD") return false;
  (async () => {
    try {
      const r = await writeClipboard(msg);
      sendResponse(r);
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message || e), diag: clipboardDiag() });
    }
  })();
  return true;
});

