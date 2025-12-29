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

    const ranges = [];
    for (let i = 0; i < sel.rangeCount; i++) ranges.push(sel.getRangeAt(i).cloneRange());
    try {
      const markers = [];
      const pairs = [];
      const toastEl = document.getElementById("__cof_toast");
      const toastParent = toastEl ? toastEl.parentNode : null;
      const toastNext = toastEl ? toastEl.nextSibling : null;
      if (toastEl && toastParent) {
        try {
          toastParent.removeChild(toastEl);
        } catch (e) {
          diag("copyOfficeFormatNonFatalError", e);
        }
      }
      for (let i = ranges.length - 1; i >= 0; i--) {
        const id = `${Date.now()}-${Math.random().toString(16).slice(2)}-${i}`;
        const startTok = `COF_START_${id}`;
        const endTok = `COF_END_${id}`;
        const startNode = document.createComment(startTok);
        const endNode = document.createComment(endTok);
        const rEnd = ranges[i].cloneRange();
        rEnd.collapse(false);
        rEnd.insertNode(endNode);
        const rStart = ranges[i].cloneRange();
        rStart.collapse(true);
        rStart.insertNode(startNode);
        markers.push(startNode, endNode);
        pairs.push([startTok, endTok]);
      }
      const pageHtml = document.documentElement ? document.documentElement.outerHTML : "";
      for (const n of markers) {
        try {
          if (n && n.parentNode) n.parentNode.removeChild(n);
        } catch (e) {
          diag("copyOfficeFormatNonFatalError", e);
        }
      }
      if (toastEl && toastParent) {
        try {
          if (toastNext && toastNext.parentNode === toastParent) {
            toastParent.insertBefore(toastEl, toastNext);
          } else {
            toastParent.appendChild(toastEl);
          }
        } catch (e) {
          diag("copyOfficeFormatNonFatalError", e);
        }
      }
      return { html: pageHtml, text, pairs };
    } catch (e) {
      diag("copyOfficeFormatNonFatalError", e);
      const div = document.createElement("div");
      for (let i = 0; i < ranges.length; i++) {
        div.appendChild(ranges[i].cloneContents());
        if (i + 1 < ranges.length) div.appendChild(document.createTextNode(" "));
      }
      return { html: div.innerHTML || "", text };
    }
  }

  cof.selection = { getSelectionHtmlAndText };
})();
