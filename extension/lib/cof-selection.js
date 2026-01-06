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

  function hasHtmlTags(s) {
    const t = String(s || "");
    // True when there is at least one HTML-looking tag like <div>, </p>, <!doctype>, etc.
    // Note: plain text can include "<5" which is not a tag; require a letter/!/ or / after "<".
    return /<\s*[A-Za-z!/][^>]*>/.test(t);
  }

  function pickSelectionContainerHtml({ range, selectionText, maxChars }) {
    try {
      const selLen = Math.max(0, Number(selectionText?.length) || 0);
      let el =
        range?.commonAncestorContainer?.nodeType === 1
          ? range.commonAncestorContainer
          : range?.commonAncestorContainer?.parentElement || null;
      if (!el) return "";

      // Heuristic: climb up a few levels, preferring a container whose text length is
      // "close" to the selection (avoid capturing the entire page).
      let best = el;
      for (let depth = 0; depth < 8; depth++) {
        if (!el) break;
        let t = "";
        try {
          t = String(el.innerText || el.textContent || "");
        } catch (e) {
          t = "";
        }
        const tLen = Math.max(0, t.length);
        if (selLen > 0 && tLen > 0) {
          // Accept containers that aren't wildly larger than the selection.
          if (tLen <= Math.max(5000, Math.floor(selLen * 2.5))) {
            best = el;
          }
        }
        el = el.parentElement;
      }

      const out = String(best?.outerHTML || "");
      if (!out) return "";
      if (maxChars && out.length > maxChars) return "";
      return out;
    } catch (e) {
      diag("copyOfficeFormatNonFatalError", e);
      return "";
    }
  }

  function getSelectionHtmlAndText() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return { html: "", text: "" };
    const text = sel.toString() || "";
    const rangeCount = Math.max(0, Number(sel.rangeCount) || 0);

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

      // Multi-range selections can happen (e.g., Ctrl+select) and some pages can yield
      // many identical/overlapping ranges. Naively appending all cloneContents() can
      // duplicate content dramatically. Prefer a single "best" range when it covers
      // (almost) the full selection text; otherwise dedupe and drop contained ranges.
      let usedRanges = [];
      let strategy = "single";
      try {
        if (rangeCount <= 1) {
          usedRanges = [sel.getRangeAt(0)];
        } else {
          const ranges = [];
          for (let i = 0; i < rangeCount; i++) {
            try {
              const r = sel.getRangeAt(i);
              const t = String(r?.toString?.() || "");
              ranges.push({ r, len: t.length });
            } catch (e) {}
          }

          const selLen = Math.max(0, String(text || "").length);
          const best = ranges.reduce((a, b) => (b.len > (a?.len || 0) ? b : a), null);

          // If any single range is effectively the whole selection, use it alone.
          if (best && best.len > 0 && (selLen === 0 || best.len >= Math.floor(selLen * 0.92))) {
            usedRanges = [best.r];
            strategy = "best-range";
          } else {
            // Dedupe identical boundaries and drop ranges fully contained by another.
            const uniq = [];
            const equals = (a, b) => {
              try {
                return (
                  a.startContainer === b.startContainer &&
                  a.startOffset === b.startOffset &&
                  a.endContainer === b.endContainer &&
                  a.endOffset === b.endOffset
                );
              } catch (e) {
                return false;
              }
            };
            for (const item of ranges) {
              if (!item?.r || item.len <= 0) continue;
              if (uniq.some((u) => equals(u, item.r))) continue;
              uniq.push(item.r);
            }

            // Sort in document order (best-effort).
            uniq.sort((a, b) => {
              try {
                return a.compareBoundaryPoints(Range.START_TO_START, b);
              } catch (e) {
                return 0;
              }
            });

            const out = [];
            for (const r of uniq) {
              const prev = out.length ? out[out.length - 1] : null;
              if (!prev) {
                out.push(r);
                continue;
              }
              try {
                const startsAfterOrEqual = prev.compareBoundaryPoints(Range.START_TO_START, r) <= 0;
                const endsAfterOrEqual = prev.compareBoundaryPoints(Range.END_TO_END, r) >= 0;
                const contained = startsAfterOrEqual && endsAfterOrEqual;
                if (!contained) out.push(r);
              } catch (e) {
                out.push(r);
              }
            }

            usedRanges = out.length ? out : [sel.getRangeAt(0)];
            strategy = "dedupe";
          }
        }
      } catch (e) {
        usedRanges = [sel.getRangeAt(0)];
        strategy = "single-fallback";
      }

      if (rangeCount > 1) {
        diag(
          "copyOfficeFormatSelectionMultiRange",
          JSON.stringify({ rangeCount, usedRangeCount: usedRanges.length, strategy }),
        );
      }

      for (let i = 0; i < usedRanges.length; i++) {
        div.appendChild(usedRanges[i].cloneContents());
        if (i + 1 < usedRanges.length) div.appendChild(document.createTextNode(" "));
      }
      const fragmentHtml = div.innerHTML || "";
      try {
        if (root?.dataset) {
          root.dataset.copyOfficeFormatSelectionCaptureMode = "fragment";
          root.dataset.copyOfficeFormatSelectionHtmlLength = String(fragmentHtml.length);
          root.dataset.copyOfficeFormatSelectionTextLength = String(text.length);
          root.dataset.copyOfficeFormatSelectionRangeCount = String(rangeCount);
          root.dataset.copyOfficeFormatSelectionUsedRangeCount = String(usedRanges.length);
          root.dataset.copyOfficeFormatSelectionUsedRangeStrategy = String(strategy);
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

  function getSelectionHtmlForCopyAsHtml() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return { html: "", text: "" };
    const { html, text } = getSelectionHtmlAndText();
    if (hasHtmlTags(html)) return { html, text };
    try {
      const maxChars =
        Number(globalThis.CONFIG?.MAX_WASM_INPUT_CHARS) || 25_000_000;
      const range = sel.getRangeAt(0);
      const containerHtml = pickSelectionContainerHtml({
        range,
        selectionText: text,
        maxChars,
      });
      if (containerHtml && hasHtmlTags(containerHtml)) return { html: containerHtml, text };
    } catch (e) {
      diag("copyOfficeFormatNonFatalError", e);
    }
    return { html, text };
  }

  cof.selection = { getSelectionHtmlAndText, getSelectionHtmlForCopyAsHtml };
})();
