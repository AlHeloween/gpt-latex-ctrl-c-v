(() => {
  const cof = (globalThis.__cof = globalThis.__cof || {});
  const diag = cof.diag || (() => {});
  const core = cof.core || {};
  const selection = cof.selection;
  const wasm = cof.wasm;
  const xslt = cof.xslt;
  const clipboard = cof.clipboard;
  const ui = cof.ui;
  const root = core.root;

  async function copyOfficeFromHtmlSelection() {
    const got = selection.getSelectionHtmlAndText();
    const text = got.text;
    if (!String(text || "").trim()) throw new Error("no selection");

    diag("copyOfficeFormatLastStage", "wasm");
    const w = await wasm.load();
    const html = got.html || "";
    if (!html) throw new Error("no selection html");
    const withMath = wasm.call1(w, "html_to_office_with_mathml", html);

    diag("copyOfficeFormatLastStage", "xslt");
    let wrappedHtml = await xslt.convertMathmlToOmmlInHtmlString(withMath);

    diag("copyOfficeFormatLastStage", "clipboard");
    const r = await clipboard.writeHtml({ html: wrappedHtml, text });
    if (!r?.ok) throw new Error(String(r?.error || "Clipboard write unavailable."));

    diag("copyOfficeFormatLastStage", "done");
    return true;
  }

  async function copyOfficeFromMarkdownSelection() {
    const got = selection.getSelectionHtmlAndText();
    const text = got.text;
    if (!String(text || "").trim()) throw new Error("no selection");

    diag("copyOfficeFormatLastStage", "wasm");
    const w = await wasm.load();
    let withMath;
    try {
      withMath = wasm.call1(w, "markdown_to_office_with_mathml", text);
      if (!withMath || typeof withMath !== "string") {
        throw new Error("WASM markdown conversion returned invalid result");
      }
    } catch (e) {
      const errMsg = String(e?.message || e || "unknown error");
      diag("copyOfficeFormatWasmMarkdownError", errMsg);
      // Check if it's a WASM panic/unreachable error
      if (errMsg.includes("unreachable") || errMsg.includes("RuntimeError")) {
        throw new Error(`Markdown conversion crashed. This may be due to invalid markdown syntax or formulas. Error: ${errMsg}`);
      }
      throw new Error(`Markdown conversion failed: ${errMsg}`);
    }

    diag("copyOfficeFormatLastStage", "xslt");
    const wrappedHtml = await xslt.convertMathmlToOmmlInHtmlString(withMath);
    if (!wrappedHtml || typeof wrappedHtml !== "string") {
      throw new Error("XSLT conversion returned invalid result");
    }

    diag("copyOfficeFormatLastStage", "clipboard");
    const r = await clipboard.writeHtml({ html: wrappedHtml, text });
    if (!r?.ok) throw new Error(String(r?.error || "Clipboard write unavailable."));

    diag("copyOfficeFormatLastStage", "done");
    return true;
  }

  async function copyAsMarkdown() {
    const got = selection.getSelectionHtmlAndText();
    const html = got.html || "";
    const text = got.text;
    if (!String(text || "").trim()) throw new Error("no selection");

    const w = await wasm.load();
    const md = html ? wasm.call1(w, "html_to_markdown", html) : text;
    const r = await clipboard.writeText(md);
    if (!r?.ok) throw new Error(String(r?.error || "Clipboard writeText unavailable."));
    return true;
  }

  async function handleCopyRequest(mode) {
    if (mode === "markdown-export") return copyAsMarkdown();
    if (mode === "markdown") return copyOfficeFromMarkdownSelection();
    return copyOfficeFromHtmlSelection();
  }

  const browserApi = core.browserApi;
  if (browserApi?.runtime?.onMessage?.addListener) {
    browserApi.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      const t = msg?.type;
      if (t === "COPY_AS_MARKDOWN")
        return (
          handleCopyRequest("markdown-export")
            .then(() => {
              ui.toast(
                globalThis.CONFIG?.MESSAGES?.COPY_MARKDOWN_SUCCESS ||
                  "Copied as Markdown.",
                false,
              );
              sendResponse?.({ ok: true });
            })
            .catch((e) => {
              const m = String(e?.message || e || "").trim() || "Copy failed.";
              diag("copyOfficeFormatLastCopyError", m);
              ui.toast(
                `${globalThis.CONFIG?.MESSAGES?.COPY_FAILED || "Copy failed."} ${m}`,
                true,
              );
              sendResponse?.({ ok: false, error: String(e?.message || e) });
            }),
          true
        );

      if (t === "COPY_OFFICE_FORMAT")
        return (
          handleCopyRequest(msg?.mode || "html")
            .then(() => {
              ui.toast(
                globalThis.CONFIG?.MESSAGES?.COPY_SUCCESS ||
                  "Copied to clipboard.",
                false,
              );
              sendResponse?.({ ok: true });
            })
            .catch((e) => {
              const m = String(e?.message || e || "").trim() || "Copy failed.";
              diag("copyOfficeFormatLastCopyError", m);
              ui.toast(
                `${globalThis.CONFIG?.MESSAGES?.COPY_FAILED || "Copy failed."} ${m}`,
                true,
              );
              sendResponse?.({ ok: false, error: String(e?.message || e) });
            }),
          true
        );
      return false;
    });
  }
})();
