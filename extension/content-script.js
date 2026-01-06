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

  function fnv1a32Hex(s) {
    let hash = 0x811c9dc5;
    const str = String(s || "");
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  }

  function plainTextFromHtmlFragment(html) {
    try {
      const container = document.createElement("div");
      container.innerHTML = String(html || "");
      // innerText preserves line breaks better than textContent for <pre>/<br>.
      const t = container.innerText || container.textContent || "";
      return String(t || "");
    } catch (_e) {
      return "";
    }
  }

  function dbg(stage, details) {
    try {
      const d =
        details && typeof details === "object"
          ? JSON.stringify(details)
          : String(details ?? "");
      diag("translationDebug", `${String(stage || "")} ${d}`.trim());
    } catch (e) {
      diag("translationDebug", `${String(stage || "")} [unserializable]`);
    }
  }

  async function withTimeout(promise, timeoutMs, label) {
    const ms = Number(timeoutMs) || 0;
    if (!ms) return promise;
    let timer = null;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(String(label || "timeout"))), ms);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function clipboardCapDiag() {
    try {
      return {
        hasClipboard: !!navigator?.clipboard,
        hasWrite: !!navigator?.clipboard?.write,
        hasWriteText: !!navigator?.clipboard?.writeText,
        hasClipboardItem: typeof ClipboardItem !== "undefined",
        secureContext: typeof window !== "undefined" ? !!window.isSecureContext : null,
      };
    } catch (e) {
      return { diagError: true };
    }
  }

  async function translateHtmlForCopy(html, config, dbgPrefix) {
    const t0 = performance.now();
    const targetLang = String(config.translation?.defaultLanguage || "en");
    const service = String(config.translation?.service || "pollinations");
    const timeoutMs = Number(config.translation?.timeoutMs) || 15000;
    const progressKey = dbgPrefix === "ctrlC" ? "translationCopyProgress" : "translationOfficeCopyProgress";
    const stageKey = dbgPrefix === "ctrlC" ? "translationCopyLastStage" : "translationOfficeCopyLastStage";
    let lastToastMs = 0;

    dbg(`${dbgPrefix}:start`, {
      service,
      targetLang,
      translateFormulas: !!config.translation?.translateFormulas,
      htmlLen: String(html || "").length,
      htmlHash: fnv1a32Hex(html),
      apiKeyPresent: !!(config.apiKeys && config.apiKeys[service]),
      timeoutMs,
    });

    diag(stageKey, "anchor");
    const { html: anchoredHtml, anchors } = anchor.anchorFormulasAndCode(String(html || ""));

    diag(stageKey, "analyze");
    const analysisResult = analysis.analyzeContent(anchoredHtml);

    diag(stageKey, "translate");
    const translatedText = await withTimeout(
      translate.translate(
        anchoredHtml,
        targetLang,
        service,
        config,
        analysisResult.embedding,
        analysisResult.frequency,
        anchors,
        (p) => {
          try {
            // Deterministic, inspectable progress (dataset + __cofLogs).
            diag(progressKey, JSON.stringify(p || {}));

            // Lightweight UI progress for long operations (not shown in tests).
            const n = Number(p?.n) || 0;
            const i = Number(p?.i) || 0;
            const phase = String(p?.phase || "");
            if (n >= 5 && (phase === "chunk-start" || phase === "chunk-done")) {
              const now = performance.now();
              if (now - lastToastMs >= 400) {
                lastToastMs = now;
                ui.toast(`Translating (${i}/${n})…`, false);
              }
            }
          } catch (e) {
            diag("copyOfficeFormatNonFatalError", String(e?.message || e || ""));
          }
        },
      ),
      timeoutMs,
      "translation timeout"
    );

    diag(stageKey, "restore-anchors");
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

    diag(stageKey, "done");
    dbg(`${dbgPrefix}:done`, { ms: Math.round(performance.now() - t0) });
    return finalHtml;
  }

  async function copyOfficeFromHtmlSelection() {
    const got = selection.getSelectionHtmlAndText();
    let text = got.text;
    if (!String(text || "").trim()) throw new Error("no selection");

    dbg("officeCopy:selection", {
      textLen: String(text || "").length,
      textHash: fnv1a32Hex(text),
      htmlLen: String(got.html || "").length,
      htmlHash: fnv1a32Hex(got.html || ""),
      clipboard: clipboardCapDiag(),
    });

    diag("copyOfficeFormatLastStage", "wasm");
    const w = await wasm.load();
    let html = got.html || "";
    if (!html) throw new Error("no selection html");

    try {
      const config = await storage.getConfig();
      if (config.translation?.enabled) {
        html = await translateHtmlForCopy(html, config, "officeCopy");
        // Ensure plain-text paste targets also receive translated text.
        const translatedPlain = plainTextFromHtmlFragment(html);
        if (translatedPlain && translatedPlain.trim()) text = translatedPlain;
      } else {
        dbg("officeCopy:gate", { enabled: false });
      }
    } catch (e) {
      // Fail open for "Copy as Office Format": if translation fails, still copy the original selection.
      diag("translationOfficeCopyError", String(e?.message || e || ""));
      dbg("officeCopy:error", { message: String(e?.message || e || "").slice(0, 200) });
      ui.toast("Translation failed; copied original selection.", true);
    }

    const withMath = wasm.call1(w, "html_to_office_with_mathml", html);
    dbg("officeCopy:wasmOk", { withMathLen: String(withMath || "").length, withMathHash: fnv1a32Hex(withMath) });

    diag("copyOfficeFormatLastStage", "xslt");
    let wrappedHtml = await xslt.convertMathmlToOmmlInHtmlString(withMath);
    dbg("officeCopy:xsltOk", { wrappedLen: String(wrappedHtml || "").length, wrappedHash: fnv1a32Hex(wrappedHtml) });

    diag("copyOfficeFormatLastStage", "clipboard");
    const r = await clipboard.writeHtml({ html: wrappedHtml, text });
    dbg("officeCopy:clipboardResult", r || null);
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
    const got = selection.getSelectionHtmlForCopyAsHtml
      ? selection.getSelectionHtmlForCopyAsHtml()
      : selection.getSelectionHtmlAndText();
    const html = got.html || "";
    if (!String(html || "").trim()) throw new Error("no selection");

    diag("extractSelectedHtmlLastStage", "clipboard");
    // Copy the selection's HTML exactly as captured by Range.cloneContents(), without Word wrappers
    // or normalization. This is intended for pasting into HTML-aware targets.
    // Set text/plain to the literal HTML so that plain-text paste targets still receive the exact markup.
    const r = await clipboard.writeHtmlExact({ html, text: html });
    if (!r?.ok) throw new Error(String(r?.error || "Clipboard writeText unavailable."));

    diag("extractSelectedHtmlLastStage", "done");
    return true;
  }

  async function handleCopyWithTranslation() {
    try {
      const t0 = performance.now();
      const config = await storage.getConfig();
      if (!config.translation?.enabled || !config.keyboard?.interceptCopy) {
        dbg("gate", {
          enabled: !!config.translation?.enabled,
          interceptCopy: !!config.keyboard?.interceptCopy,
        });
        return false; // Translation not enabled or interception disabled
      }

      const got = selection.getSelectionHtmlAndText();
      const html = got.html || "";
      let text = got.text || "";
      if (!String(text).trim()) return false;

      dbg("start", {
        service: String(config.translation?.service || "pollinations"),
        targetLang: String(config.translation?.defaultLanguage || "en"),
        translateFormulas: !!config.translation?.translateFormulas,
        textLen: String(text).length,
        textHash: fnv1a32Hex(text),
        htmlLen: String(html).length,
        htmlHash: fnv1a32Hex(html),
        apiKeyPresent: !!(config.apiKeys && config.apiKeys[String(config.translation?.service || "pollinations")]),
      });

      // Reuse the same HTML translation pipeline as "Copy as Office Format".
      const finalHtml = await translateHtmlForCopy(html, config, "ctrlC");
      const translatedPlain = plainTextFromHtmlFragment(finalHtml);
      if (translatedPlain && translatedPlain.trim()) text = translatedPlain;

      diag("translationCopyLastStage", "process-wasm");
      const w = await wasm.load();
      const withMath = wasm.call1(w, "html_to_office_with_mathml", finalHtml);

      diag("translationCopyLastStage", "xslt");
      const wrappedHtml = await xslt.convertMathmlToOmmlInHtmlString(withMath);

      diag("translationCopyLastStage", "clipboard");
      const r = await clipboard.writeHtml({ html: wrappedHtml, text });
      if (!r?.ok) throw new Error(String(r?.error || "Clipboard write unavailable."));

      diag("translationCopyLastStage", "done");
      dbg("done", { ms: Math.round(performance.now() - t0) });
      return true;
    } catch (e) {
      diag("translationCopyError", String(e?.message || e));
      dbg("error", { message: String(e?.message || e || "").slice(0, 200) });
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
      if (!config.keyboard?.interceptCopy) {
        dbg("gate", { enabled: !!config.translation?.enabled, interceptCopy: false });
        return;
      }
      if (!config.translation?.enabled) {
        dbg("gate", { enabled: false, interceptCopy: true });
        return;
      }

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
          const text = sel.toString();
          const r = await clipboard.writeText(text);
          if (!r?.ok) {
            diag("copyInterceptionFallbackError", String(r?.error || "Clipboard write failed"));
            throw new Error(String(r?.error || "Clipboard write unavailable"));
          }
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
          const text = sel.toString();
          const r = await clipboard.writeText(text);
          if (!r?.ok) {
            diag("copyInterceptionFallbackError", String(r?.error || "Clipboard write failed"));
            throw new Error(String(r?.error || "Clipboard write unavailable"));
          }
        }
      } catch (e2) {
        diag("copyInterceptionFallbackError", String(e2));
        throw e2; // Re-throw to ensure error is not silently ignored
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
              ui.toast("Copied selection HTML to clipboard.", false);
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

      if (t === "COPY_AS_HTML")
        return (
          extractSelectedHtml()
            .then(() => {
              ui.toast("Copied selection HTML to clipboard.", false);
              sendResponse?.({ ok: true });
            })
            .catch((e) => {
              const m = String(e?.message || e || "").trim() || "Copy failed.";
              diag("extractSelectedHtmlLastError", m);
              ui.toast(`Copy failed. ${m}`, true);
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
