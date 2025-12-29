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

  function wrapHtmlForWord(htmlFragment) {
    // Wrap HTML fragment in Word-compatible HTML document structure
    // This improves compatibility with Word and Google Docs
    const htmlBody = String(htmlFragment || "").trim();
    
    // Check if already wrapped
    if (htmlBody.toLowerCase().includes("<html") && htmlBody.toLowerCase().includes("<body")) {
      return htmlBody;
    }
    
    // Wrap in proper HTML structure with Word-compatible meta tags
    return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns:m="http://schemas.microsoft.com/office/2004/12/omml"
      xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="ProgId" content="Word.Document">
<meta name="Generator" content="Microsoft Word">
<meta name="Originator" content="Microsoft Word">
<!--[if gte mso 9]><xml>
<w:WordDocument>
<w:View>Print</w:View>
<w:Zoom>90</w:Zoom>
<w:DoNotOptimizeForBrowser/>
</w:WordDocument>
</xml><![endif]-->
</head>
<body>
${htmlBody}
</body>
</html>`;
  }

  async function writeHtml({ html, text }) {
    // Transpile HTML to Word-compatible format
    const wordCompatibleHtml = wrapHtmlForWord(html);
    
    if (navigator?.clipboard?.write && typeof ClipboardItem !== "undefined") {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([wordCompatibleHtml], { type: "text/html" }),
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
