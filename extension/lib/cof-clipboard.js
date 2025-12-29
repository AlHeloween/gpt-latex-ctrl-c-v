(() => {
  const cof = (globalThis.__cof = globalThis.__cof || {});
  const diag = cof.diag || (() => {});
  const core = cof.core || {};
  const root = core.root;

  async function bgSend(payload) {
    try {
      if (!core.browserApi?.runtime?.sendMessage) return null;
      return await core.browserApi.runtime.sendMessage(payload);
    } catch (e) {
      diag("copyOfficeFormatLastBgSendError", e?.message || e || "");
      return { ok: false, error: String(e?.message || e || "") };
    }
  }

  async function writeHtml({ html, text }) {
    if (navigator?.clipboard?.write && typeof ClipboardItem !== "undefined") {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([text || ""], { type: "text/plain" }),
          }),
        ]);
        return { ok: true, via: "clipboard-api" };
      } catch (e) {
        diag("copyOfficeFormatLastClipboardWriteError", e?.message || e || "");
      }
    }

    const r = await bgSend({
      type: "WRITE_CLIPBOARD",
      mode: "html",
      html: String(html || ""),
      text: String(text || ""),
    });
    if (r?.ok) return { ok: true, via: "background" };
    const d = r?.diag ? ` diag=${JSON.stringify(r.diag)}` : "";
    return { ok: false, error: String(r?.error || "Clipboard write unavailable.") + d };
  }

  async function writeText(text) {
    const t = String(text || "");

    if (navigator?.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(t);
        return { ok: true, via: "clipboard-api" };
      } catch (e) {
        diag("copyOfficeFormatLastClipboardWriteError", e?.message || e || "");
      }
    }

    const r = await bgSend({ type: "WRITE_CLIPBOARD", mode: "text", text: t });
    if (r?.ok) return { ok: true, via: "background" };
    const d = r?.diag ? ` diag=${JSON.stringify(r.diag)}` : "";
    return { ok: false, error: String(r?.error || "Clipboard writeText unavailable.") + d };
  }

  cof.clipboard = { writeHtml, writeText };
})();
