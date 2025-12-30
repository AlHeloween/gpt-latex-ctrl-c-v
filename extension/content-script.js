(() => {
  const cof = (globalThis.__cof = globalThis.__cof || {});
  const diag = cof.diag || (() => {});
  const core = cof.core || {};
  const selection = cof.selection;
  const wasm = cof.wasm;
  const xslt = cof.xslt;
  const clipboard = cof.clipboard;
  const ui = cof.ui;
  const storage = cof.storage;
  const anchor = cof.anchor;
  const analysis = cof.analysis;
  const translate = cof.translate;
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

  async function extractSelectedHtml() {
    const got = selection.getSelectionHtmlAndText();
    const html = got.html || "";
    if (!String(html || "").trim()) throw new Error("no selection");

    diag("extractSelectedHtmlLastStage", "wasm-normalize");
    const w = await wasm.load();
    // Process HTML through the same normalization pipeline as Office format
    const normalizedHtml = wasm.call1(w, "html_to_office", html);

    diag("extractSelectedHtmlLastStage", "extract-text");
    // Extract formatted plain text from normalized HTML
    // Use DOMParser for safer HTML parsing (normalizedHtml is already sanitized by WASM)
    const parser = new DOMParser();
    const doc = parser.parseFromString(normalizedHtml, "text/html");
    const tempDiv = doc.body || doc.documentElement;
    let formattedText = tempDiv.innerText || tempDiv.textContent || "";
    // Clean up: normalize whitespace but preserve line breaks
    formattedText = formattedText.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

    diag("extractSelectedHtmlLastStage", "clipboard");
    const r = await clipboard.writeText(formattedText);
    if (!r?.ok) throw new Error(String(r?.error || "Clipboard writeText unavailable."));

    diag("extractSelectedHtmlLastStage", "done");
    return true;
  }

  async function handleCopyWithTranslation() {
    try {
      const config = await storage.getConfig();
      if (!config.translation?.enabled || !config.keyboard?.interceptCopy) {
        return false; // Translation not enabled or interception disabled
      }

      const got = selection.getSelectionHtmlAndText();
      const html = got.html || "";
      const text = got.text || "";
      if (!String(text).trim()) return false;

      diag("translationCopyLastStage", "anchor");
      const { html: anchoredHtml, anchors } = anchor.anchorFormulasAndCode(html);

      diag("translationCopyLastStage", "analyze");
      const analysisResult = analysis.analyzeContent(anchoredHtml);

      diag("translationCopyLastStage", "translate");
      const targetLang = config.translation?.defaultLanguage || "en";
      const service = config.translation?.service || "pollinations";
      const translatedText = await translate.translate(
        anchoredHtml,
        targetLang,
        service,
        config,
        analysisResult.embedding,
        analysisResult.frequency,
        anchors
      );

      diag("translationCopyLastStage", "restore-anchors");
      let finalHtml = translatedText;
      if (config.translation?.translateFormulas && ["chatgpt", "gemini", "pollinations", "custom"].includes(service)) {
        const formulas = anchor.extractAnchoredFormulas(anchors);
        const translatedFormulas = await translate.translateFormulas(
          formulas,
          service,
          config.apiKeys[service] || "",
          targetLang,
          config.customApi
        );
        finalHtml = anchor.restoreAnchors(translatedText, anchors, true, translatedFormulas);
      } else {
        finalHtml = anchor.restoreAnchors(translatedText, anchors, false);
      }

      diag("translationCopyLastStage", "process-wasm");
      const w = await wasm.load();
      const withMath = wasm.call1(w, "html_to_office_with_mathml", finalHtml);

      diag("translationCopyLastStage", "xslt");
      const wrappedHtml = await xslt.convertMathmlToOmmlInHtmlString(withMath);

      diag("translationCopyLastStage", "clipboard");
      const r = await clipboard.writeHtml({ html: wrappedHtml, text });
      if (!r?.ok) throw new Error(String(r?.error || "Clipboard write unavailable."));

      diag("translationCopyLastStage", "done");
      return true;
    } catch (e) {
      diag("translationCopyError", String(e?.message || e));
      return false; // Return false to allow normal copy
    }
  }

  async function handleCopyRequest(mode) {
    if (mode === "markdown-export") return copyAsMarkdown();
    if (mode === "markdown") return copyOfficeFromMarkdownSelection();
    return copyOfficeFromHtmlSelection();
  }

  async function handleCopyInterception(event) {
    // Check if Ctrl-C (or Cmd-C on Mac)
    const isModifierPressed = event.ctrlKey || event.metaKey;
    const isC = event.key === "c" || event.keyCode === 67;
    const isShiftPressed = event.shiftKey;

    if (!isModifierPressed || !isC) return;

    // Bypass if Shift is also pressed (Shift+Ctrl-C for normal copy)
    if (isShiftPressed) return;

    try {
      // Check if interception is enabled
      const config = await storage.getConfig();
      if (!config.keyboard?.interceptCopy) return;
      if (!config.translation?.enabled) return;

      // Prevent default copy
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      // Handle translation copy
      const handled = await handleCopyWithTranslation();
      if (!handled) {
        // If translation failed, do normal copy
        const sel = window.getSelection();
        if (sel && sel.toString()) {
          document.execCommand("copy");
        }
      } else {
        ui.toast("Translated content copied to clipboard.", false);
      }
    } catch (e) {
      diag("copyInterceptionError", String(e));
      // Fallback to normal copy on error
      try {
        const sel = window.getSelection();
        if (sel && sel.toString()) {
          document.execCommand("copy");
        }
      } catch (e2) {
        diag("copyInterceptionFallbackError", String(e2));
      }
    }
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

      if (t === "EXTRACT_SELECTED_HTML")
        return (
          extractSelectedHtml()
            .then(() => {
              ui.toast("Extracted formatted text to clipboard.", false);
              sendResponse?.({ ok: true });
            })
            .catch((e) => {
              const m = String(e?.message || e || "").trim() || "Extraction failed.";
              diag("extractSelectedHtmlLastError", m);
              ui.toast(`Extraction failed. ${m}`, true);
              sendResponse?.({ ok: false, error: String(e?.message || e) });
            }),
          true
        );
      return false;
    });
  }

  // Set up copy interception
  document.addEventListener("keydown", handleCopyInterception, true);
})();
