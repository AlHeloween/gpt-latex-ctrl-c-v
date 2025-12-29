(() => {
  const cof = (globalThis.__cof = globalThis.__cof || {});
  const diag = cof.diag || (() => {});
  const core = cof.core || {};
  const root = core.root;

  function isSelectionSourceDoc() {
    try {
      const bodyId = String(document?.body?.id || "").toLowerCase();
      const title = String(document?.title || "").toLowerCase();
      return bodyId === "viewsource" || title.includes("dom source of selection");
    } catch (e) {
      diag("copyOfficeFormatNonFatalError", e);
      return false;
    }
  }

  function extractHtmlFromSelectionSource(text) {
    const s = String(text || "");
    const idx = s.search(/<(?!!--)[A-Za-z!/]/);
    return idx >= 0 ? s.slice(idx).trim() : "";
  }

  function getSelectionHtmlAndText() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return { html: "", text: "" };
    const text = sel.toString() || "";

    if (isSelectionSourceDoc()) {
      try {
        if (root?.dataset) root.dataset.copyOfficeFormatSelectionSourceDocDetected = "true";
      } catch (e) {
        diag("copyOfficeFormatNonFatalError", e);
      }
      const bodyTxt = String(document?.body?.textContent || "");
      const useBody = bodyTxt && text && text.length < Math.floor(bodyTxt.length * 0.8);
      const extracted = extractHtmlFromSelectionSource(useBody ? bodyTxt : text);
      if (extracted) return { html: extracted, text };
    }

    try {
      const maxChars =
        Number(globalThis.CONFIG?.MAX_WASM_INPUT_CHARS) || 25_000_000;
      const div = document.createElement("div");
      for (let i = 0; i < sel.rangeCount; i++) {
        div.appendChild(sel.getRangeAt(i).cloneContents());
        if (i + 1 < sel.rangeCount) div.appendChild(document.createTextNode(" "));
      }
      const fragmentHtml = div.innerHTML || "";
      try {
        if (root?.dataset) {
          root.dataset.copyOfficeFormatSelectionCaptureMode = "fragment";
          root.dataset.copyOfficeFormatSelectionHtmlLength = String(fragmentHtml.length);
          root.dataset.copyOfficeFormatSelectionTextLength = String(text.length);
        }
      } catch (e) {
        diag("copyOfficeFormatNonFatalError", e);
      }

      if (fragmentHtml && fragmentHtml.length <= maxChars) return { html: fragmentHtml, text };
      diag("copyOfficeFormatLastCopyError", `selection html too large (${fragmentHtml.length} chars)`);
      return { html: "", text };
    } catch (e) {
      diag("copyOfficeFormatNonFatalError", e);
      const div = document.createElement("div");
      for (let i = 0; i < sel.rangeCount; i++) {
        div.appendChild(sel.getRangeAt(i).cloneContents());
        if (i + 1 < sel.rangeCount) div.appendChild(document.createTextNode(" "));
      }
      return { html: div.innerHTML || "", text };
    }
  }

  cof.selection = { getSelectionHtmlAndText };
})();
