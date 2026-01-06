(() => {
  const cof = (globalThis.__cof = globalThis.__cof || {});
  const diag = cof.diag || (() => {});
  const core = cof.core || {};
  const root = core.root;

  function dbg(stage, details) {
    try {
      const d =
        details && typeof details === "object"
          ? JSON.stringify(details)
          : String(details ?? "");
      diag("clipboardDebug", `${String(stage || "")} ${d}`.trim());
    } catch (e) {
      diag("clipboardDebug", `${String(stage || "")} [unserializable]`);
    }
  }

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
    // IMPORTANT: write the selection fragment as-is. The browser/OS will wrap this into CF_HTML
    // with StartFragment/EndFragment markers. Wrapping again into a full HTML document can cause
    // nested <html>/<body> and has been observed to behave poorly in some paste targets.
    const fragmentHtml = String(html || "");
    dbg("writeHtml:start", { htmlLen: fragmentHtml.length, textLen: String(text || "").length });
    
    if (navigator?.clipboard?.write && typeof ClipboardItem !== "undefined") {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([fragmentHtml], { type: "text/html" }),
            "text/plain": new Blob([text || ""], { type: "text/plain" }),
          }),
        ]);
        dbg("writeHtml:ok", { via: "clipboard-api" });
        return { ok: true, via: "clipboard-api" };
      } catch (e) {
        diag("copyOfficeFormatLastClipboardWriteError", e?.message || e || "");
        dbg("writeHtml:clipboardApiError", String(e?.message || e || ""));
      }
    }

    const r = await bgSend({
      type: "WRITE_CLIPBOARD",
      mode: "html",
      html: fragmentHtml,
      text: String(text || ""),
    });
    dbg("writeHtml:bgResponse", r || null);
    if (r?.ok) return { ok: true, via: "background" };
    const d = r?.diag ? ` diag=${JSON.stringify(r.diag)}` : "";
    return { ok: false, error: String(r?.error || "Clipboard write unavailable.") + d };
  }

  async function writeHtmlExact({ html, text }) {
    const exactHtml = String(html || "");
    const t = String(text || "");
    dbg("writeHtmlExact:start", { htmlLen: exactHtml.length, textLen: t.length });

    if (navigator?.clipboard?.write && typeof ClipboardItem !== "undefined") {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([exactHtml], { type: "text/html" }),
            "text/plain": new Blob([t], { type: "text/plain" }),
          }),
        ]);
        dbg("writeHtmlExact:ok", { via: "clipboard-api" });
        return { ok: true, via: "clipboard-api" };
      } catch (e) {
        diag("copyOfficeFormatLastClipboardWriteError", e?.message || e || "");
        dbg("writeHtmlExact:clipboardApiError", String(e?.message || e || ""));
      }
    }

    const r = await bgSend({
      type: "WRITE_CLIPBOARD",
      mode: "html",
      html: exactHtml,
      text: t,
    });
    dbg("writeHtmlExact:bgResponse", r || null);
    if (r?.ok) return { ok: true, via: "background" };
    const d = r?.diag ? ` diag=${JSON.stringify(r.diag)}` : "";
    return { ok: false, error: String(r?.error || "Clipboard write unavailable.") + d };
  }

  async function writeText(text) {
    const t = String(text || "");
    dbg("writeText:start", { textLen: t.length });

    if (navigator?.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(t);
        dbg("writeText:ok", { via: "clipboard-api" });
        return { ok: true, via: "clipboard-api" };
      } catch (e) {
        diag("copyOfficeFormatLastClipboardWriteError", e?.message || e || "");
        dbg("writeText:clipboardApiError", String(e?.message || e || ""));
      }
    }

    const r = await bgSend({ type: "WRITE_CLIPBOARD", mode: "text", text: t });
    dbg("writeText:bgResponse", r || null);
    if (r?.ok) return { ok: true, via: "background" };
    const d = r?.diag ? ` diag=${JSON.stringify(r.diag)}` : "";
    return { ok: false, error: String(r?.error || "Clipboard writeText unavailable.") + d };
  }

  cof.clipboard = { writeHtml, writeHtmlExact, writeText };
})();
