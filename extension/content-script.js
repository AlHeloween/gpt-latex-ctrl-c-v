(() => {
  const browser = globalThis.browser ?? globalThis.chrome;
  // Configuration - can be overridden by constants.js if loaded
  // Note: Check for global CONFIG first (from constants.js), then use default
  let CONFIG;
  if (typeof window !== 'undefined' && window.CONFIG) {
    CONFIG = window.CONFIG;
  } else {
    CONFIG = {
      CACHE_MAX_SIZE: 100,
      MATHJAX_LOAD_TIMEOUT: 10000,
      LATEX_TO_MATHML_TIMEOUT: 5000,
      LATEX_TO_OMML_TIMEOUT: 8000,
      LARGE_SELECTION_THRESHOLD: 50000,
      NOTIFICATION_DURATION: 3000,
      EXCLUDED_TAGS: ["CODE", "PRE", "KBD", "SAMP", "TEXTAREA"],
      MESSAGES: {
        NO_SELECTION: "No text selected.",
        SELECTION_INVALID: "Selection is invalid. Please select text again.",
        SELECTION_LOST: "Selection was lost during processing. Please select again.",
        COPY_SUCCESS: "Copied to clipboard in Office format.",
        COPY_FAILED: "Copy failed; see console for details.",
        CLIPBOARD_DENIED: "Clipboard access denied. Please check permissions."
      }
    };
  }
  
  // Debug mode - set to false in production
  const DEBUG = false;
  
  const log = DEBUG ? console.log.bind(console, "[Copy as Office Format]") : () => {};
  const logError = console.error.bind(console, "[Copy as Office Format]");
  const logWarn = DEBUG ? console.warn.bind(console, "[Copy as Office Format]") : () => {};

  const IS_TEST_PAGE = (() => {
    try {
      if (typeof window === "undefined") return false;
      const isLocalHost =
        window.location.hostname === "127.0.0.1" ||
        window.location.hostname === "localhost" ||
        window.location.hostname === "";
      const isSupportedProtocol = window.location.protocol === "file:" || (isLocalHost && window.location.protocol.startsWith("http"));
      if (!isSupportedProtocol) return false;

      const normalizedPath = window.location.pathname.replace(/\\/g, "/").toLowerCase();
      const isInTestsDir = normalizedPath.includes("/tests/") || normalizedPath.includes("/_ff_ext_copy/tests/");
      const isInExamplesDir = normalizedPath.includes("/examples/") || normalizedPath.includes("/_ff_ext_copy/examples/");
      const filename = normalizedPath.split("/").pop() || "";
      const isTestFile =
        filename.startsWith("test_") ||
        filename.endsWith("-test.html") ||
        filename.startsWith("selection_example") ||
        filename === "chatgpt_example.html" ||
        filename === "debug-extension.html" ||
        filename === "diagnose_extension.html";
      return isInTestsDir || isInExamplesDir || isTestFile;
    } catch {
      return false;
    }
  })();

  let lastClipboardPayload = null;

  function ensureTestBridge() {
    if (!IS_TEST_PAGE || typeof document === "undefined") return null;

    try {
      document.documentElement.dataset.copyOfficeFormatExtensionLoaded = "true";
      document.documentElement.dataset.copyOfficeFormatVersion = "0.2.0";
      try {
        if (browser && browser.runtime && typeof browser.runtime.getURL === "function") {
          document.documentElement.dataset.copyOfficeFormatMathJaxUrl = browser.runtime.getURL("mathjax/tex-mml-chtml.js");
        }
      } catch {
        // ignore
      }

      let bridge = document.getElementById("__copyOfficeFormatTestBridge");
      if (!bridge) {
        bridge = document.createElement("textarea");
        bridge.id = "__copyOfficeFormatTestBridge";
        bridge.setAttribute("aria-hidden", "true");
        bridge.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;";
        document.documentElement.appendChild(bridge);
      }
      return bridge;
    } catch {
      return null;
    }
  }

  function updateTestBridge() {
    const bridge = ensureTestBridge();
    if (!bridge) return;
    try {
      bridge.value = JSON.stringify({ lastClipboard: lastClipboardPayload });
      try {
        document.documentElement.dataset.copyOfficeFormatBridgeUpdated = String(Date.now());
        document.documentElement.dataset.copyOfficeFormatBridgeValueLength = String(bridge.value.length);
      } catch {
        // ignore
      }
    } catch {
      // ignore
    }
  }

  let mathJaxLoadPromise = null;
  let xsltPromise = null;
  let rustWasmPromise = null;

  function normalizeLatexCommon(latex) {
    // Deterministic/local cleanup: remove characters that commonly break tokenization.
    let s = String(latex ?? "");
    // Remove zero-width characters that often sneak into copied math identifiers (q_r​, etc).
    s = s.replace(/[\u200B\u200C\u200D\u2060\uFEFF]/g, "");
    // Double-vertical bar (norm). Convert to plain bars to avoid unknown tokens.
    s = s.replace(/\u2016/g, "||"); // ‖
    return s;
  }

  function normalizeLatexForRust(latex) {
    // Rust WASM converter is intentionally simple: keep input inspectable and avoid introducing macros.
    // NOTE: latex2mathml does not support most control sequences; any backslash should skip Rust.
    let s = normalizeLatexCommon(latex);
    // Some sites use PUA glyphs for symbols (e.g., ≠). Replace known ones conservatively with Unicode.
    s = s.replace(/\uE020/g, "≠");
    return s;
  }

  function normalizeLatexForMathJax(latex) {
    // MathJax is our "full" converter; it can handle macros and richer LaTeX.
    let s = normalizeLatexCommon(latex);
    // Some sites use PUA glyphs for symbols (e.g., ≠). Replace known ones conservatively.
    s = s.replace(/\uE020/g, "\\neq");
    // Normalize a few common Unicode math symbols into LaTeX commands for consistent MathJax output.
    s = s
      .replace(/\u2297/g, "\\otimes") // ⊗
      .replace(/\u03F5/g, "\\epsilon") // ϵ
      .replace(/\u03D5/g, "\\phi") // ϕ
      .replace(/\u2192/g, "\\to") // →
      .replace(/\u2260/g, "\\neq") // ≠
      .replace(/\u27E8/g, "\\langle") // ⟨
      .replace(/\u27E9/g, "\\rangle"); // ⟩
    return s;
  }

  async function ensureRustWasmMathConverter() {
    if (rustWasmPromise) return rustWasmPromise;

    rustWasmPromise = (async () => {
      if (typeof WebAssembly === "undefined") {
        throw new Error("WebAssembly not available");
      }
      if (!browser || !browser.runtime || typeof browser.runtime.getURL !== "function") {
        throw new Error("browser.runtime.getURL not available");
      }

      const url = browser.runtime.getURL("wasm/tex_to_mathml.wasm");
      const r = await fetch(url);
      if (!r.ok) throw new Error(`Failed to fetch wasm: ${r.status}`);
      const bytes = await r.arrayBuffer();
      const { instance } = await WebAssembly.instantiate(bytes, {});
      const e = instance.exports || {};

      const required = [
        "memory",
        "api_version",
        "alloc",
        "dealloc",
        "tex_to_mathml",
        "last_len",
        "last_err_ptr",
        "last_err_len",
        "last_err_code",
        "clear_last_error",
      ];
      for (const k of required) {
        if (!(k in e)) throw new Error(`wasm missing export: ${k}`);
      }
      const api = e.api_version();
      if (api !== 1) throw new Error(`wasm api_version mismatch: ${api}`);

      return {
        exports: e,
        encoder: new TextEncoder(),
        decoder: new TextDecoder("utf-8"),
      };
    })().catch((err) => {
      rustWasmPromise = null; // allow retry
      throw err;
    });

    return rustWasmPromise;
  }

  async function rustLatexToMathml(latex, display) {
    const m = await ensureRustWasmMathConverter();
    const e = m.exports;

    const normalized = normalizeLatexForRust(latex);
    const input = m.encoder.encode(String(normalized || ""));
    if (!input.length) return { ok: false, error: "empty input" };

    const inPtr = e.alloc(input.length);
    new Uint8Array(e.memory.buffer, inPtr, input.length).set(input);

    const outPtr = e.tex_to_mathml(inPtr, input.length, display ? 1 : 0);
    e.dealloc(inPtr, input.length);

    if (!outPtr) {
      const errPtr = e.last_err_ptr();
      const errLen = e.last_err_len();
      const errCode = e.last_err_code();
      let errMsg = `wasm convert failed (code=${errCode})`;
      try {
        if (errPtr && errLen) {
          const b = new Uint8Array(e.memory.buffer, errPtr, errLen);
          errMsg = m.decoder.decode(b) || errMsg;
          e.dealloc(errPtr, errLen);
        }
      } catch {
        // ignore
      }
      try {
        e.clear_last_error();
      } catch {
        // ignore
      }
      return { ok: false, error: errMsg };
    }

    const outLen = e.last_len();
    if (!outLen) {
      try {
        e.dealloc(outPtr, 0);
      } catch {
        // ignore
      }
      return { ok: false, error: "wasm returned empty output" };
    }

    const outBytes = new Uint8Array(e.memory.buffer, outPtr, outLen);
    const mathml = m.decoder.decode(outBytes);
    e.dealloc(outPtr, outLen);

    return { ok: true, mathml };
  }

  browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    log("🔵 Message received in content script!");
    log("   Message type:", msg.type);
    log("   Sender:", sender);
    
    if (msg.type === "COPY_OFFICE_FORMAT") {
      log("✅ COPY_OFFICE_FORMAT message received - calling handleCopy()");
      handleCopy().then(() => {
        log("✅ handleCopy() completed successfully");
        sendResponse({success: true});
      }).catch(err => {
        logError("❌ Error in handleCopy():", err);
        logError("   Error name:", err.name);
        logError("   Error message:", err.message);
        logError("   Error stack:", err.stack);
        try {
          notify(CONFIG.MESSAGES.COPY_FAILED + " " + (err.message || "Unknown error"));
        } catch (e) {
          logError("Failed to notify:", e);
        }
        sendResponse({success: false, error: err.message});
      });
      return true; // Keep channel open for async response
    } else {
      log("⚠️ Unknown message type:", msg.type);
    }
    return false;
  });
  
  // Listen for test events from page context (for automated testing)
  window.addEventListener('__extension_test_copy', (event) => {
    if (event.detail && event.detail.type === 'COPY_OFFICE_FORMAT') {
      log("🔵 Test copy event received from page context - calling handleCopy()");
      handleCopy().then(() => {
        log("✅ handleCopy() completed successfully (from test event)");
      }).catch((err) => {
        logError("❌ handleCopy() failed (from test event):", err);
      });
    }
  });
  
  // Notify background script that content script is ready
  try {
    browser.runtime.sendMessage({type: "EXTENSION_READY"}).catch(() => {
      // Ignore errors - background script may not be ready yet
    });
  } catch (e) {
    // Ignore errors during initialization
  }

  // Store selection range to prevent loss during async operations
  // Note: Cross-frame selections (across iframes) are not fully supported
  // The selection must be within a single frame/document
  function captureSelection() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    
    try {
      const range = sel.getRangeAt(0).cloneRange();
      
      // Check if selection spans multiple frames (basic check)
      const startDoc = range.startContainer.ownerDocument || range.startContainer;
      const endDoc = range.endContainer.ownerDocument || range.endContainer;
      if (startDoc !== endDoc) {
        logWarn("Cross-frame selection detected, may not work correctly");
      }
      
      const html = getSelectionHtml();
      const text = getSelectionText();
      
      return {
        range: range,
        html: html,
        text: text,
        isValid: function() {
          try {
            // Verify range is still valid (nodes are connected to DOM)
            if (!this.range) return false;
            const startContainer = this.range.startContainer;
            const endContainer = this.range.endContainer;
            
            // Check if containers are still in the document
            if (startContainer.nodeType === Node.TEXT_NODE || startContainer.nodeType === Node.ELEMENT_NODE) {
              let node = startContainer;
              while (node && node !== document) {
                if (!node.isConnected) return false;
                node = node.parentNode;
              }
            }
            
            return true;
          } catch {
            return false;
          }
        }
      };
    } catch (e) {
      logWarn("Failed to capture selection:", e);
      return null;
    }
  }

  async function handleCopy() {
    log("🔵 handleCopy() called - START");
    log("   Current URL:", window.location.href);
    log("   Document ready state:", document.readyState);
    
    // Capture selection immediately to prevent loss during async operations
    log("📋 Capturing selection...");
    const selection = captureSelection();
    if (!selection) {
      notify(CONFIG.MESSAGES.NO_SELECTION);
      return;
    }
    
    // Verify selection is valid
    if (!selection.isValid()) {
      notify(CONFIG.MESSAGES.SELECTION_INVALID);
      return;
    }
    
    const selectionHtml = selection.html;
    const selectionText = selection.text;
    
    log("Selection HTML length:", selectionHtml ? selectionHtml.length : 0);
    log("Selection text length:", selectionText ? selectionText.length : 0);
    
    if (!selectionHtml && !selectionText.trim()) {
      notify(CONFIG.MESSAGES.NO_SELECTION);
      return;
    }

    try {
      
      // If we have HTML, preserve it and convert LaTeX within it
      let processedHtml = selectionHtml || escapeHtml(selectionText);
      let plainText = selectionText || stripTags(selectionHtml);
      
      if (selectionHtml) {
        const { ommlHtml } = await convertLatexInHtml(selectionHtml);
        processedHtml = ommlHtml;
      } else if (selectionText) {
        // Plain text with LaTeX - convert it
        const texBlocks = extractLatex(selectionText);
        const ommlParts = [];
        const mathmlParts = [];
        
        for (const tex of texBlocks) {
          try {
            // Check if original text had $$ or \[ for display math
            const texIndex = selectionText.indexOf(tex);
            let isDisplay = false;
            if (texIndex > 0) {
              const before = selectionText.substring(Math.max(0, texIndex - 2), texIndex);
              const after = selectionText.substring(texIndex + tex.length, Math.min(selectionText.length, texIndex + tex.length + 2));
              isDisplay = (before === "$$" && after === "$$") || before.endsWith("\\[") || after.startsWith("\\]");
            }
            const mathml = await latexToMathml(tex, isDisplay);
            mathmlParts.push(mathml);
            const omml = await latexToOmml(tex);
            ommlParts.push(omml);
          } catch (err) {
            console.warn("LaTeX conversion failed for:", tex, err);
            ommlParts.push(escapeHtml(tex));
            mathmlParts.push("");
          }
        }
        
        if (ommlParts.length > 0) {
          processedHtml = combineFragments(ommlParts, mathmlParts);
        } else {
          processedHtml = escapeHtml(selectionText);
        }
      }

      // Verify selection is still valid before clipboard write
      if (!selection.isValid()) {
        notify(CONFIG.MESSAGES.SELECTION_LOST);
        return;
      }
      
      if (IS_TEST_PAGE && typeof window !== 'undefined' && window.__copyOfficeFormatExtension) {
        window.__copyOfficeFormatExtension.lastPayload = {
          html: processedHtml,
          plainText,
          timestamp: Date.now()
        };
      }
      if (IS_TEST_PAGE) {
        try {
          const wrapped = wrapHtmlDoc(processedHtml);
          lastClipboardPayload = {
            cfhtml: buildCfHtml(wrapped, location.href),
            wrappedHtml: wrapped,
            plainText,
            via: "pre-write",
            timestamp: Date.now()
          };
        } catch (e) {
          try {
            document.documentElement.dataset.copyOfficeFormatBridgeError = e && e.message ? e.message : String(e);
          } catch {
            // ignore
          }
        }
        updateTestBridge();
      }

      log("Calling writeClipboard...");
      await writeClipboard(processedHtml, plainText);
      log("✅ Copy completed successfully");
      notify(CONFIG.MESSAGES.COPY_SUCCESS);
    } catch (err) {
      logError("❌ Copy failed:", err);
      logError("Error stack:", err.stack);
      if (IS_TEST_PAGE) {
        try {
          document.documentElement.dataset.copyOfficeFormatLastCopyError = err && err.message ? err.message : String(err);
        } catch {
          // ignore
        }
        try {
          lastClipboardPayload = {
            error: err && err.message ? err.message : String(err),
            errorType: err && err.name ? String(err.name) : (err && err.constructor ? err.constructor.name : "Error"),
            plainText: selectionText || stripTags(selectionHtml),
            selectionHtmlLength: selectionHtml ? selectionHtml.length : 0,
            selectionTextLength: selectionText ? selectionText.length : 0,
            via: "error",
            timestamp: Date.now()
          };
          updateTestBridge();
        } catch {
          // ignore
        }
      }
      notify(CONFIG.MESSAGES.COPY_FAILED + " " + (err.message || "Unknown error"));
      // Fallback: copy plain text
      try {
        log("Attempting fallback plain text copy...");
        await navigator.clipboard.writeText(selectionText || stripTags(selectionHtml));
        log("✅ Fallback plain text copy successful");
        notify("Copied as plain text (formulas not converted)");
      } catch (clipboardErr) {
        logError("❌ Fallback clipboard write failed:", clipboardErr);
        logError("Fallback error name:", clipboardErr.name);
        logError("Fallback error message:", clipboardErr.message);
        notify(CONFIG.MESSAGES.CLIPBOARD_DENIED);
      }
    }
  }

  function getSelectionText() {
    const sel = window.getSelection();
    if (!sel) return "";
    
    // Check for collapsed selection (cursor position, no text)
    if (sel.isCollapsed) return "";
    
    return sel.toString();
  }

  function getSelectionHtml() {
    const sel = window.getSelection && window.getSelection();
    if (!sel || sel.rangeCount === 0) return "";
    
    // Check for collapsed selection (cursor position, no text)
    if (sel.isCollapsed) return "";
    
    try {
      const range = sel.getRangeAt(0).cloneRange();
      const div = document.createElement("div");
      div.appendChild(range.cloneContents());
      return div.innerHTML.trim();
    } catch (e) {
      logWarn("Failed to get selection HTML:", e);
      return "";
    }
  }

  function extractLatex(text) {
    // Enhanced regex supporting multiple LaTeX formats
    // Handle escaped dollars: \$ should not be treated as delimiter
    // Note: Negative lookbehind (?<!\\) requires modern browser support
    // IMPORTANT: Match $$...$$ BEFORE $...$ to avoid partial matches
    const patterns = [
      /(?<!\\)\$\$([\s\S]+?)(?<!\\)\$\$/g,  // Display: $$...$$ (allow newlines; check first!)
      /\\\[[\s\S]*?\\\]/g,                   // Display: \[...\] (allow newlines)
      /\\\([\s\S]*?\\\)/g,                   // Inline: \(...\) (allow newlines)
      /(?<!\\)\$(.+?)(?<!\\)\$/g,      // Inline: $...$ (not \$) - after $$ check
      /\\begin\{(\w+)\}[\s\S]*?\\end\{\1\}/g  // Environments with matching braces
    ];
    
    const matches = [];
    for (const pattern of patterns) {
      try {
        const found = [...text.matchAll(pattern)];
        matches.push(...found);
      } catch (e) {
        // Fallback if lookbehind not supported
        if (pattern.source.includes("<!\\")) {
          // Manual parsing for escaped dollars
          const fallbackPattern = /\$(.+?)\$/g;
          const fallbackMatches = [...text.matchAll(fallbackPattern)];
          // Filter out matches where $ is escaped
          for (const m of fallbackMatches) {
            const idx = m.index;
            if (idx > 0 && text[idx - 1] !== "\\") {
              matches.push(m);
            }
          }
        }
      }
    }
    
    if (!matches.length) return [];
    
    return matches.map(m => {
      const raw = m[0];
      if (raw.startsWith("$$")) {
        // Double dollar display math: $$...$$
        return raw.slice(2, -2).trim();
      } else if (raw.startsWith("$")) {
        // Single dollar inline math: $...$
        return raw.slice(1, -1).trim();
      } else if (raw.startsWith("\\[")) {
        // Display math: \[...\]
        return raw.slice(2, -2).trim();
      } else if (raw.startsWith("\\(")) {
        // Inline math: \(...\)
        return raw.slice(2, -2).trim();
      } else {
        // Environment or other format
        return raw.trim();
      }
    }).filter(Boolean);
  }

	  async function ensureMathTools() {
	    // CSP-friendly: no inline scripts. Always prefer loading a web_accessible_resources page bridge.
	    if (!mathJaxLoadPromise) {
	      mathJaxLoadPromise = Promise.race([
	        new Promise((resolve, reject) => {
	          const root = document.documentElement;
	          const getStatus = () => (root && root.dataset ? root.dataset.copyOfficeFormatMathJaxStatus : null);
	          const getError = () => (root && root.dataset ? root.dataset.copyOfficeFormatMathJaxError : null);

	          const status = getStatus();
	          if (status === "ready") return resolve();
	          if (status === "error") return reject(new Error(getError() || "MathJax bridge error"));

	          const src = browser.runtime.getURL("page-mathjax-bridge.js");
	          const already = document.querySelector(`script[src="${src}"]`);
	          if (!already) {
	            const s = document.createElement("script");
	            s.src = src;
	            s.async = true;
	            s.onload = () => {};
	            s.onerror = () => reject(new Error("Failed to load page-mathjax-bridge.js"));
	            (document.head || document.documentElement).appendChild(s);
	          }

	          const poll = () => {
	            const st = getStatus();
	            if (st === "ready") return resolve();
	            if (st === "error") return reject(new Error(getError() || "MathJax failed to load"));
	            setTimeout(poll, 50);
	          };
	          poll();
	        }),
	        new Promise((_, reject) => {
	          setTimeout(() => reject(new Error(CONFIG.MESSAGES.MATHJAX_LOAD_TIMEOUT || "MathJax load timeout")), CONFIG.MATHJAX_LOAD_TIMEOUT);
	        }),
	      ]).catch((err) => {
	        mathJaxLoadPromise = null; // allow retry
	        throw err;
	      });
	    }

	    await mathJaxLoadPromise;

	    if (!xsltPromise) {
	      xsltPromise = fetch(browser.runtime.getURL("assets/mathml2omml.xsl"))
	        .then((r) => {
	          if (!r.ok) throw new Error(`${CONFIG.MESSAGES.XSLT_FETCH_FAILED || "XSLT fetch failed"}: ${r.status}`);
	          return r.text();
	        })
	        .then((txt) => {
	          const doc = new DOMParser().parseFromString(txt, "application/xml");
	          const parseError = doc.querySelector("parsererror");
	          if (parseError) {
	            throw new Error((CONFIG.MESSAGES.XSLT_PARSE_ERROR || "XSLT parse error") + ": " + parseError.textContent);
	          }
	          return doc;
	        });
	    }
	    await xsltPromise;
	    return;

	    // Test pages: use a DOM-event bridge so it works in Chromium isolated worlds.
	    if (IS_TEST_PAGE) {
	      if (!mathJaxLoadPromise) {
	        const mathJaxUrl = browser.runtime.getURL("mathjax/tex-mml-chtml.js");

        mathJaxLoadPromise = Promise.race([
          new Promise((resolve, reject) => {
            const injectScript = document.createElement("script");
            injectScript.textContent = `
              (function() {
                try {
                  var root = document.documentElement;
                  function setStatus(status, error) {
                    try {
                      root.dataset.copyOfficeFormatMathJaxStatus = status;
                      if (error) root.dataset.copyOfficeFormatMathJaxError = String(error);
                    } catch (e) {}
                  }

                  if (!window.__copyOfficeFormatMathJaxTestBridgeInstalled) {
                    window.__copyOfficeFormatMathJaxTestBridgeInstalled = true;
                    document.addEventListener("__copyOfficeFormatMathJaxRequest", function(ev) {
                      var d = ev && ev.detail ? ev.detail : {};
                      var requestId = d.requestId || null;
                      var latex = d.latex != null ? String(d.latex) : "";
                      var display = !!d.display;

                      function respond(ok, payload) {
                        try {
                          document.dispatchEvent(new CustomEvent("__copyOfficeFormatMathJaxResponse", {
                            detail: Object.assign({ requestId: requestId, ok: ok }, payload || {})
                          }));
                        } catch (e) {}
                      }

                      (async function() {
                        try {
                          if (!window.MathJax) throw new Error("MathJax not available");
                          if (window.MathJax.startup && window.MathJax.startup.promise) {
                            await window.MathJax.startup.promise;
                          }
                          if (typeof window.MathJax.tex2mmlPromise !== "function") throw new Error("MathJax methods not available");
                          var mathml = await window.MathJax.tex2mmlPromise(latex, { display: display });
                          respond(true, { mathml: mathml });
                        } catch (e) {
                          respond(false, { error: e && e.message ? e.message : String(e) });
                        }
                      })();
                    });
                  }

                  if (window.MathJax) {
                    setStatus("ready");
                    return;
                  }

                  setStatus("loading");
                  var s = document.createElement("script");
                  s.src = ${JSON.stringify(mathJaxUrl)};
                  s.async = true;
	                  s.onload = function() {
	                    var attempts = 0;
	                    function check() {
	                      attempts++;
	                      if (window.MathJax) {
	                        if (window.MathJax.startup && window.MathJax.startup.promise) {
	                          window.MathJax.startup.promise
	                            .then(function() { setStatus("ready"); try { s.remove(); } catch (e) {} })
	                            .catch(function(err) { setStatus("error", err && err.message ? err.message : err); try { s.remove(); } catch (e) {} });
	                        } else if (typeof window.MathJax.tex2mmlPromise === "function") {
	                          setStatus("ready");
	                          try { s.remove(); } catch (e) {}
	                        } else {
	                          setStatus("error", "MathJax methods not available");
	                          try { s.remove(); } catch (e) {}
	                        }
	                        return;
	                      }
	                      if (attempts > 200) {
	                        setStatus("error", "Timeout");
	                        try { s.remove(); } catch (e) {}
	                        return;
	                      }
	                      setTimeout(check, 50);
	                    }
	                    setTimeout(check, 0);
	                  };
	                  s.onerror = function() { setStatus("error", "Load failed"); try { s.remove(); } catch (e) {} };
                  (document.head || document.documentElement).appendChild(s);
                } catch (e) {
                  try { document.documentElement.dataset.copyOfficeFormatMathJaxStatus = "error"; } catch (e2) {}
                }
              })();
            `;

            (document.head || document.documentElement).appendChild(injectScript);
            injectScript.remove();

            const poll = () => {
              const root = document.documentElement;
              const status = root && root.dataset ? root.dataset.copyOfficeFormatMathJaxStatus : null;
              const error = root && root.dataset ? root.dataset.copyOfficeFormatMathJaxError : null;
              if (status === "ready") return resolve();
              if (status === "error") return reject(new Error(error || "MathJax failed to load"));
              setTimeout(poll, 50);
            };

            poll();
          }),
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error(CONFIG.MESSAGES.MATHJAX_LOAD_TIMEOUT || "MathJax load timeout")), CONFIG.MATHJAX_LOAD_TIMEOUT);
          })
        ]).catch((err) => {
          mathJaxLoadPromise = null; // allow retry
          throw err;
        });
      }

      await mathJaxLoadPromise;

      // XSLT loading (same as normal path)
      if (!xsltPromise) {
        xsltPromise = fetch(browser.runtime.getURL("assets/mathml2omml.xsl"))
          .then((r) => {
            if (!r.ok) throw new Error(`${CONFIG.MESSAGES.XSLT_FETCH_FAILED || "XSLT fetch failed"}: ${r.status}`);
            return r.text();
          })
          .then((txt) => {
            const doc = new DOMParser().parseFromString(txt, "application/xml");
            const parseError = doc.querySelector("parsererror");
            if (parseError) {
              throw new Error((CONFIG.MESSAGES.XSLT_PARSE_ERROR || "XSLT parse error") + ": " + parseError.textContent);
            }
            return doc;
          });
      }

      await xsltPromise;
      return;
    }
    // Use promise instead of boolean flag to prevent race conditions
    if (!mathJaxLoadPromise) {
      log("📦 Starting MathJax load...");
      const mathJaxUrl = browser.runtime.getURL("mathjax/tex-mml-chtml.js");
      log("   MathJax URL:", mathJaxUrl);
      
      mathJaxLoadPromise = Promise.race([
        new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = browser.runtime.getURL("mathjax/tex-mml-chtml.js");
          script.async = true;
          script.onload = () => {
            log("✅ MathJax script loaded, waiting for MathJax to initialize...");
            
            // Poll for MathJax to become available (it initializes asynchronously)
            const maxAttempts = 100; // 10 seconds max (100 * 100ms)
            let attempts = 0;
            
            const checkMathJax = () => {
              attempts++;
              log(`   Checking MathJax (attempt ${attempts}/${maxAttempts})...`);
              
              if (typeof MathJax !== 'undefined' && MathJax !== null) {
                log("✅ MathJax object found!");
                log("   typeof MathJax.startup:", typeof MathJax.startup);
                
                // Check if startup.promise exists
                if (MathJax.startup && MathJax.startup.promise) {
                  log("✅ MathJax.startup.promise found, waiting for startup...");
                  MathJax.startup.promise.then(() => {
                    log("✅ MathJax startup complete!");
                    script.remove();
                    resolve();
                  }).catch((err) => {
                    logError("❌ MathJax startup promise rejected:", err);
                    script.remove();
                    reject(err);
                  });
                  return;
                }
                
                // Check if tex2mmlPromise is available directly
                if (typeof MathJax.tex2mmlPromise === 'function') {
                  log("✅ MathJax.tex2mmlPromise available, using directly");
                  script.remove();
                  resolve();
                  return;
                }
                
                // MathJax exists but doesn't have expected methods
                logError("❌ MathJax object found but missing expected methods");
                logError("   MathJax keys:", Object.keys(MathJax));
                script.remove();
                reject(new Error("MathJax object missing expected methods"));
                return;
              }
              
              // MathJax not ready yet, check again
              if (attempts < maxAttempts) {
                setTimeout(checkMathJax, 100); // Check every 100ms
              } else {
                logError("❌ MathJax object not available after", maxAttempts * 100, "ms");
                script.remove();
                reject(new Error("MathJax object not available after script load"));
              }
            };
            
            // Start checking after a small initial delay
            setTimeout(checkMathJax, 100);
          };
          script.onerror = (event) => {
            logError("❌ MathJax script load error!");
            logError("   Event:", event);
            logError("   Script src:", script.src);
            script.remove();
            reject(new Error(CONFIG.MESSAGES.MATHJAX_LOAD_FAILED || "MathJax failed to load"));
          };
          
          log("📦 Injecting MathJax into page context (not isolated content script context)...");
          log("   Script src:", script.src);
          
          // Inject MathJax into page context using script injection
          // This allows MathJax to access the page's window object properly
          const injectScript = document.createElement('script');
          injectScript.textContent = `
            (function() {
              if (window.__mathjaxLoading) return; // Already loading
              window.__mathjaxLoading = true;
              
              const script = document.createElement('script');
              script.src = '${script.src}';
              script.async = true;
              script.onload = function() {
                // MathJax should now be available on window.MathJax
                if (typeof window.MathJax !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('__mathjax-loaded', {detail: {success: true}}));
                } else {
                  // Poll for MathJax
                  let attempts = 0;
                  const check = setInterval(function() {
                    attempts++;
                    if (typeof window.MathJax !== 'undefined') {
                      clearInterval(check);
                      window.dispatchEvent(new CustomEvent('__mathjax-loaded', {detail: {success: true}}));
                    } else if (attempts > 100) {
                      clearInterval(check);
                      window.dispatchEvent(new CustomEvent('__mathjax-loaded', {detail: {success: false, error: 'Timeout'}}));
                    }
                  }, 100);
                }
              };
              script.onerror = function() {
                window.dispatchEvent(new CustomEvent('__mathjax-loaded', {detail: {success: false, error: 'Load failed'}}));
              };
              (document.head || document.documentElement).appendChild(script);
            })();
          `;
          (document.head || document.documentElement).appendChild(injectScript);
          injectScript.remove();
          
          // Listen for MathJax loaded event from page context
          const mathJaxLoadedHandler = (event) => {
            log("📥 MathJax loaded event received from page context");
            window.removeEventListener('__mathjax-loaded', mathJaxLoadedHandler);
            
            if (event.detail && event.detail.success) {
              // MathJax is loaded in page context, now we need to use it
              // We'll inject functions into page context to call MathJax
              log("✅ MathJax loaded successfully in page context");
              log("   Setting up MathJax bridge...");
              
              // Inject bridge function into page context to call MathJax
              const bridgeScript = document.createElement('script');
              bridgeScript.textContent = `
                (function() {
                  try {
                    window.__mathjaxConvert = function(latex, display) {
                      return new Promise(function(resolve, reject) {
                        try {
                          if (typeof window.MathJax === 'undefined') {
                            reject(new Error('MathJax not available'));
                            return;
                          }
                          
                          // Use MathJax to convert
                          if (window.MathJax.startup && window.MathJax.startup.promise) {
                            window.MathJax.startup.promise.then(function() {
                              return window.MathJax.tex2mmlPromise(latex, {display: display || false});
                            }).then(function(mathml) {
                              resolve(mathml);
                            }).catch(reject);
                          } else if (typeof window.MathJax.tex2mmlPromise === 'function') {
                            window.MathJax.tex2mmlPromise(latex, {display: display || false})
                              .then(resolve)
                              .catch(reject);
                          } else {
                            reject(new Error('MathJax methods not available'));
                          }
                        } catch (e) {
                          reject(e);
                        }
                      });
                    };
                    // Bridge is ready
                    window.__mathjaxBridgeReady = true;
                  } catch (e) {
                    console.error('Bridge setup error:', e);
                    window.__mathjaxBridgeError = e.message;
                  }
                })();
              `;
              (document.head || document.documentElement).appendChild(bridgeScript);
              bridgeScript.remove();
              
              // Bridge script injected, wait a moment for it to execute
              // Events don't cross content script/page boundary, so we just wait
              setTimeout(() => {
                log("✅ MathJax bridge ready!");
                resolve();
              }, 300); // Give bridge time to set up
              
            } else {
              logError("❌ MathJax failed to load in page context:", event.detail ? event.detail.error : 'Unknown error');
              reject(new Error(event.detail ? event.detail.error : "MathJax failed to load"));
            }
          };
          
          // Also handle bridge errors
          const bridgeErrorHandler = (event) => {
            logError("❌ MathJax bridge setup error:", event.detail ? event.detail.error : 'Unknown error');
            window.removeEventListener('__mathjax-bridge-error', bridgeErrorHandler);
            reject(new Error(event.detail ? event.detail.error : "MathJax bridge setup failed"));
          };
          
          window.addEventListener('__mathjax-loaded', mathJaxLoadedHandler);
          window.addEventListener('__mathjax-bridge-error', bridgeErrorHandler);
          log("✅ Injection code executed, waiting for MathJax...");
        }),
        new Promise((_, reject) => {
          setTimeout(() => {
            logError("❌ MathJax load timeout after", CONFIG.MATHJAX_LOAD_TIMEOUT, "ms");
            reject(new Error(CONFIG.MESSAGES.MATHJAX_LOAD_TIMEOUT || "MathJax load timeout"));
          }, CONFIG.MATHJAX_LOAD_TIMEOUT);
        })
      ]).catch(err => {
        logError("❌ MathJax loading failed:", err);
        mathJaxLoadPromise = null; // Reset on error to allow retry
        throw err;
      });
    } else {
      log("📦 MathJax already loading, waiting for existing promise...");
    }
    await mathJaxLoadPromise;
    log("✅ MathJax ready!");
    
    // XSLT loading
    if (!xsltPromise) {
      xsltPromise = fetch(browser.runtime.getURL("assets/mathml2omml.xsl"))
        .then((r) => {
          if (!r.ok) throw new Error(`${CONFIG.MESSAGES.XSLT_FETCH_FAILED || "XSLT fetch failed"}: ${r.status}`);
          return r.text();
        })
        .then((txt) => {
          const doc = new DOMParser().parseFromString(txt, "application/xml");
          // Check for parse errors
          const parseError = doc.querySelector("parsererror");
          if (parseError) {
            throw new Error((CONFIG.MESSAGES.XSLT_PARSE_ERROR || "XSLT parse error") + ": " + parseError.textContent);
          }
          return doc;
        });
    }
    await xsltPromise;
  }

  async function latexToMathml(latex, display = false) {
    const rustInput = normalizeLatexForRust(latex);
    const mathJaxInput = normalizeLatexForMathJax(latex);
    if (IS_TEST_PAGE) {
      try {
        document.documentElement.dataset.copyOfficeFormatLastLatexPreview = mathJaxInput.slice(0, 220);
      } catch {
        // ignore
      }
    }

    // Deterministic path: use Rust WASM converter (no page CSP dependency).
    // Tests can force this path via: <html data-copy-office-format-force-wasm="true">.
    const forceWasm =
      IS_TEST_PAGE &&
      typeof document !== "undefined" &&
      document.documentElement &&
      document.documentElement.dataset &&
      document.documentElement.dataset.copyOfficeFormatForceWasm === "true";

    try {
      if (rustInput.includes("\\")) {
        if (forceWasm) throw new Error("rust-wasm skipped (contains backslash control sequences)");
        throw new Error("rust-wasm skipped");
      }
      const res = await rustLatexToMathml(rustInput, !!display);
      if (res && res.ok && typeof res.mathml === "string") {
        if (IS_TEST_PAGE) {
          try {
            document.documentElement.dataset.copyOfficeFormatMathConverterUsed = "rust-wasm";
          } catch {
            // ignore
          }
        }
        return res.mathml;
      }
      if (forceWasm) {
        throw new Error(res && res.error ? res.error : "rust-wasm conversion failed");
      }
    } catch (e) {
      if (IS_TEST_PAGE) {
        try {
          document.documentElement.dataset.copyOfficeFormatMathConverterUsed = "rust-wasm-error";
          document.documentElement.dataset.copyOfficeFormatMathConverterError = e && e.message ? e.message : String(e);
        } catch {
          // ignore
        }
      }
      if (forceWasm) throw e;
      // fall back to previous converters
    }

    // Prefer background conversion when available (Firefox MV2 background page).
    // This avoids site CSP blocking page-context script injection (e.g., Gemini).
    try {
      if (browser && browser.runtime && typeof browser.runtime.sendMessage === "function") {
        const timeoutMs = Math.max(CONFIG.MATHJAX_LOAD_TIMEOUT || 10000, CONFIG.LATEX_TO_MATHML_TIMEOUT || 5000);
        const res = await Promise.race([
          browser.runtime.sendMessage({ type: "LATEX_TO_MATHML", latex: mathJaxInput, display: !!display }),
          new Promise((_, reject) => setTimeout(() => reject(new Error("Background MathJax timeout")), timeoutMs)),
        ]);
        if (res && res.ok && typeof res.mathml === "string") {
          return res.mathml;
        }
      }
    } catch {
      // Ignore and fall back to page-bridge conversion.
    }

    await ensureMathTools();

    function convertViaDomEvents() {
      const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

      return new Promise((resolve, reject) => {
        const handler = (event) => {
          const detail = event && event.detail ? event.detail : {};
          if (detail.requestId !== requestId) return;
          document.removeEventListener("__copyOfficeFormatMathJaxResponse", handler);

          if (detail.ok && typeof detail.mathml === "string") resolve(detail.mathml);
          else reject(new Error(detail.error || "MathJax conversion failed"));
        };

        document.addEventListener("__copyOfficeFormatMathJaxResponse", handler);
        document.dispatchEvent(new CustomEvent("__copyOfficeFormatMathJaxRequest", { detail: { requestId, latex: mathJaxInput, display } }));
      });
    }

    // Add timeout wrapper for conversion
    // Use bridge function injected into page context (MathJax runs in page context, not isolated content script context)
    if (typeof window.__mathjaxConvert === 'function') {
      log("📞 Calling MathJax bridge function for conversion...");
      return Promise.race([
        window.__mathjaxConvert(mathJaxInput, display),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error(CONFIG.MESSAGES.LATEX_CONVERSION_TIMEOUT || "LaTeX to MathML conversion timeout")), CONFIG.LATEX_TO_MATHML_TIMEOUT)
        )
      ]);
    } else {
      // Fallback: try direct access (might work if MathJax is in same context)
      log("⚠️ Bridge function not available, trying direct MathJax access...");
      if (typeof MathJax !== 'undefined' && typeof MathJax.tex2mmlPromise === 'function') {
        return Promise.race([
          MathJax.tex2mmlPromise(mathJaxInput, { display: display }),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error(CONFIG.MESSAGES.LATEX_CONVERSION_TIMEOUT || "LaTeX to MathML conversion timeout")), CONFIG.LATEX_TO_MATHML_TIMEOUT)
          )
        ]);
      } else {
        return Promise.race([
          convertViaDomEvents(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error(CONFIG.MESSAGES.LATEX_CONVERSION_TIMEOUT || "LaTeX to MathML conversion timeout")), CONFIG.LATEX_TO_MATHML_TIMEOUT)
          )
        ]);
      }
    }
  }

  async function latexToOmml(latex) {
    // Feature detection
    if (typeof XSLTProcessor === 'undefined') {
      throw new Error("XSLTProcessor not available");
    }

    async function ensureXslt() {
      if (!xsltPromise) {
        xsltPromise = fetch(browser.runtime.getURL("assets/mathml2omml.xsl"))
          .then((r) => {
            if (!r.ok) throw new Error(`${CONFIG.MESSAGES.XSLT_FETCH_FAILED || "XSLT fetch failed"}: ${r.status}`);
            return r.text();
          })
          .then((txt) => {
            const doc = new DOMParser().parseFromString(txt, "application/xml");
            const parseError = doc.querySelector("parsererror");
            if (parseError) {
              throw new Error((CONFIG.MESSAGES.XSLT_PARSE_ERROR || "XSLT parse error") + ": " + parseError.textContent);
            }
            return doc;
          });
      }
      await xsltPromise;
    }
    
    // Add timeout wrapper
    return Promise.race([
      (async () => {
        await ensureXslt();
        const mathml = await latexToMathml(latex);
        const xslt = await xsltPromise;
        
        // Validate MathML before transformation
        const mathmlDoc = new DOMParser().parseFromString(mathml, "application/xml");
        const parseError = mathmlDoc.querySelector("parsererror");
        if (parseError) {
          throw new Error((CONFIG.MESSAGES.MATHML_PARSE_ERROR || "MathML parse error") + ": " + parseError.textContent);
        }
        
        // Validate XSLT document
        if (!xslt || !xslt.documentElement) {
          throw new Error("XSLT document is invalid");
        }
        
        try {
          const proc = new XSLTProcessor();
          proc.importStylesheet(xslt);
          const ommlDoc = proc.transformToDocument(mathmlDoc);
          
          // Check for transformation errors
          if (!ommlDoc || !ommlDoc.documentElement) {
            throw new Error("XSLT transformation produced invalid document");
          }
          
          return new XMLSerializer().serializeToString(ommlDoc.documentElement);
        } catch (err) {
          logError("XSLT transformation failed:", err);
          throw err;
        }
      })(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error(CONFIG.MESSAGES.LATEX_CONVERSION_TIMEOUT || "LaTeX to OMML conversion timeout")), CONFIG.LATEX_TO_OMML_TIMEOUT)
      )
    ]);
  }

  async function convertLatexInHtml(html) {
    if (
      !html ||
      (!html.includes("$") &&
        !html.includes("\\[") &&
        !html.includes("$$") &&
        !html.includes("data-math") &&
        !html.includes("katex") &&
        !html.includes("<math"))
    ) {
      return { visualHtml: html, ommlHtml: html };
    }

    const ommlRoot = document.createElement("div");
    // Use safer HTML parsing
    const body = safeParseHtml(html);
    ommlRoot.replaceChildren(...body.childNodes);
    
    // Performance: For very large selections, process in chunks
    // Check if selection is large
    const isLargeSelection = html.length > CONFIG.LARGE_SELECTION_THRESHOLD;
    if (isLargeSelection) {
      log("Large selection detected, processing may take longer");
    }

    const exclude = new Set(CONFIG.EXCLUDED_TAGS);
    
    // LRU Cache implementation to prevent unbounded growth
    class LRUCache {
      constructor(maxSize = 100) {
        this.maxSize = maxSize;
        this.cache = new Map();
      }
      
      get(key) {
        if (!this.cache.has(key)) return undefined;
        const value = this.cache.get(key);
        // Move to end (most recently used)
        this.cache.delete(key);
        this.cache.set(key, value);
        return value;
      }
      
      set(key, value) {
        if (this.cache.has(key)) {
          this.cache.delete(key);
        } else if (this.cache.size >= this.maxSize) {
          // Remove least recently used (first item)
          const firstKey = this.cache.keys().next().value;
          this.cache.delete(firstKey);
        }
        this.cache.set(key, value);
      }
    }
    
    const cache = new LRUCache(CONFIG.CACHE_MAX_SIZE);
    // IMPORTANT: Match $$...$$ BEFORE $...$ to avoid partial matches
    // Allow newlines inside display math (Gemini/LLM outputs often format $$ blocks across lines).
    const latexRegex = /(\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\\begin\{.*?\}[\s\S]*?\\end\{.*?\}|\$\$([\s\S]+?)\$\$|\$([\s\S]+?)\$)/g;

    await processRoot(ommlRoot);
    const outHtml = await convertMathmlToOmmlInString(ommlRoot.innerHTML);

    return { visualHtml: html, ommlHtml: outHtml };

    async function convertMathmlToOmmlInString(htmlString) {
      // IMPORTANT: Keep this conversion string-based. Browsers may drop unknown
      // CSS properties (e.g. `mso-element`) and namespaced tags when round-tripping
      // through the HTML DOM. For clipboard/Office HTML, we must preserve them.
      if (!htmlString || !htmlString.includes("<math")) return htmlString;
      if (typeof XSLTProcessor === "undefined") return htmlString;

      // Ensure XSLT is loaded even when MathML conversion happened via background MathJax.
      try {
        if (!xsltPromise) {
          xsltPromise = fetch(browser.runtime.getURL("assets/mathml2omml.xsl"))
            .then((r) => {
              if (!r.ok) throw new Error(`${CONFIG.MESSAGES.XSLT_FETCH_FAILED || "XSLT fetch failed"}: ${r.status}`);
              return r.text();
            })
            .then((txt) => {
              const doc = new DOMParser().parseFromString(txt, "application/xml");
              const parseError = doc.querySelector("parsererror");
              if (parseError) {
                throw new Error((CONFIG.MESSAGES.XSLT_PARSE_ERROR || "XSLT parse error") + ": " + parseError.textContent);
              }
              return doc;
            });
        }
        await xsltPromise;
      } catch (e) {
        if (IS_TEST_PAGE) {
          try {
            document.documentElement.dataset.copyOfficeFormatMathmlToOmmlError = e && e.message ? e.message : String(e);
          } catch {
            // ignore
          }
        }
        return htmlString;
      }

      const xslt = await xsltPromise;
      if (!xslt || !xslt.documentElement) return htmlString;

      const proc = new XSLTProcessor();
      proc.importStylesheet(xslt);

      const reMath = /<math\b[\s\S]*?<\/math>/gi;
      let converted = 0;

      // Async replace helper.
      const parts = [];
      let lastIndex = 0;
      for (const m of htmlString.matchAll(reMath)) {
        const rawMatch = m[0];
        const match = stripMathmlAnnotations(rawMatch);
        const start = m.index ?? 0;
        const end = start + rawMatch.length;
        parts.push(htmlString.slice(lastIndex, start));

        const cacheKey = `mathml-omml:${match}`;
        let conv = cache.get(cacheKey);
        if (!conv) {
          try {
            const mathmlDoc = new DOMParser().parseFromString(match, "application/xml");
            const parseError = mathmlDoc.querySelector("parsererror");
            if (parseError) {
              conv = { wrapped: match };
            } else {
              const ommlDoc = proc.transformToDocument(mathmlDoc);
              if (!ommlDoc || !ommlDoc.documentElement) {
                conv = { wrapped: match };
              } else {
                const omml = new XMLSerializer().serializeToString(ommlDoc.documentElement);
                const isBlock = /\bdisplay\s*=\s*"block"/i.test(match);
                const style = isBlock ? "mso-element:omath; display:block;" : "mso-element:omath; display:inline-block;";
                conv = { wrapped: `<span style=\"${style}\">${omml}${match}</span>` };
              }
            }
          } catch {
            conv = { wrapped: match };
          }
          cache.set(cacheKey, conv);
        }

        parts.push(conv.wrapped || match);
        converted += 1;
        lastIndex = end;
      }
      parts.push(htmlString.slice(lastIndex));

      if (IS_TEST_PAGE) {
        try {
          document.documentElement.dataset.copyOfficeFormatMathmlToOmmlConverted = String(converted);
        } catch {
          // ignore
        }
      }

      return parts.join("");
    }

    async function processRoot(root) {
      // Ensure $$...$$ blocks aren't split across multiple adjacent text nodes due to HTML indentation/newlines.
      // This is critical for large SSR selections (Gemini) where the DOM often contains many text node boundaries.
      try {
        root.normalize();
      } catch {
        // ignore
      }

      // KaTeX: prefer existing embedded MathML (katex-mathml) over any conversion.
      // This path is CSP-proof (no script injection) and matches what the user actually selected.
      const katexDisplayNodes = Array.from(root.querySelectorAll(".katex-display"));
      const katexInlineNodes = Array.from(root.querySelectorAll(".katex"));

      let katexFound = 0;
      let katexReplaced = 0;

      function replaceWithMathML(wrapperEl, mathEl, display) {
        const span = document.createElement("span");
        span.className = "math-mathml";
        span.style.cssText = display ? "display:block;" : "display:inline-block;";
        appendStringAsNodes(span, stripMathmlAnnotations(mathEl.outerHTML));
        wrapperEl.replaceWith(span);
      }

      for (const wrapper of katexDisplayNodes) {
        try {
          if (!wrapper) continue;
          if (isExcluded(wrapper, exclude)) continue;
          const math = wrapper.querySelector(".katex-mathml math") || wrapper.querySelector("math");
          if (!math || !math.outerHTML) continue;
          katexFound += 1;
          replaceWithMathML(wrapper, math, true);
          katexReplaced += 1;
        } catch {
          // ignore
        }
      }

      // Inline KaTeX nodes not already replaced via katex-display.
      for (const el of katexInlineNodes) {
        try {
          if (!el || !el.closest) continue;
          if (el.closest(".katex-display")) continue;
          if (isExcluded(el, exclude)) continue;
          const math = el.querySelector(".katex-mathml math") || el.querySelector("math");
          if (!math || !math.outerHTML) continue;
          katexFound += 1;
          const displayAttr = (math.getAttribute("display") || "").toLowerCase();
          const isDisplay = displayAttr == "block";
          replaceWithMathML(el, math, isDisplay);
          katexReplaced += 1;
        } catch {
          // ignore
        }
      }

      if (IS_TEST_PAGE) {
        try {
          document.documentElement.dataset.copyOfficeFormatKatexFound = String(katexFound);
          document.documentElement.dataset.copyOfficeFormatKatexReplaced = String(katexReplaced);
        } catch {
          // ignore
        }
      }

      // Convert KaTeX-style elements that preserve source TeX as attributes.
      // Example: <span class="math-inline" data-math="\\mathbb{R}^n">...</span>
      const attrMathNodes = Array.from(root.querySelectorAll("[data-math]"));
      if (IS_TEST_PAGE) {
        try {
          document.documentElement.dataset.copyOfficeFormatAttrMathFound = String(attrMathNodes.length);
          document.documentElement.dataset.copyOfficeFormatAttrMathConverted = "0";
        } catch {
          // ignore
        }
      }
      let attrConverted = 0;
      for (const el of attrMathNodes) {
        try {
          if (!el || !el.getAttribute) continue;
          if (isExcluded(el, exclude)) continue;

          // Prefer extracting MathML already present in KaTeX-rendered markup.
          // This avoids CSP-dependent MathJax loading on complex sites (e.g., Gemini) and is faster.
          const existingMath = el.querySelector("math") || el.querySelector(".katex-mathml math");
          if (existingMath && existingMath.outerHTML) {
            const span = document.createElement("span");
            span.className = "math-mathml";
            span.style.cssText = "display:inline-block;";
            appendStringAsNodes(span, stripMathmlAnnotations(existingMath.outerHTML));
            el.replaceWith(span);
            attrConverted += 1;
            if (IS_TEST_PAGE) {
              try {
                document.documentElement.dataset.copyOfficeFormatAttrMathConverted = String(attrConverted);
                document.documentElement.dataset.copyOfficeFormatAttrMathUsedExistingMathML = "true";
              } catch {
                // ignore
              }
            }
            continue;
          }

          const latexRaw = el.getAttribute("data-math");
          const latex = latexRaw != null ? String(latexRaw).trim() : "";
          if (!latex) continue;

          const cls = (el.getAttribute("class") || "").toLowerCase();
          const isDisplay = cls.includes("math-display") || cls.includes("math-block");
          const cacheKey = isDisplay ? `display:${latex}` : `inline:${latex}`;
          let conv = cache.get(cacheKey);
          if (!conv) {
            try {
              const mathml = await latexToMathml(latex, isDisplay);
              conv = { mathml };
              cache.set(cacheKey, conv);
            } catch (e) {
              logWarn("attribute latex convert failed", e);
              if (IS_TEST_PAGE) {
                try {
                  document.documentElement.dataset.copyOfficeFormatAttrMathLastError = e && e.message ? e.message : String(e);
                } catch {
                  // ignore
                }
              }
              continue;
            }
          }

          const span = document.createElement("span");
          span.className = "math-mathml";
          span.style.cssText = "display:inline-block;";
          appendStringAsNodes(span, stripMathmlAnnotations(conv.mathml));
          el.replaceWith(span);
          attrConverted += 1;
          if (IS_TEST_PAGE) {
            try {
              document.documentElement.dataset.copyOfficeFormatAttrMathConverted = String(attrConverted);
            } catch {
              // ignore
            }
          }
        } catch (e) {
          if (
            IS_TEST_PAGE &&
            document.documentElement &&
            document.documentElement.dataset &&
            document.documentElement.dataset.copyOfficeFormatForceWasm === "true"
          ) {
            throw e;
          }
          // keep the original element if conversion fails
        }
      }

      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      const textNodes = [];
      while (walker.nextNode()) textNodes.push(walker.currentNode);

      for (const node of textNodes) {
        const text = node.nodeValue;
        if (!text || (!text.includes("$") && !text.includes("\\[") && !text.includes("$$"))) continue;
        if (isExcluded(node, exclude)) continue;

        latexRegex.lastIndex = 0;
        let match;
        let lastIndex = 0;
        const segments = [];
        while ((match = latexRegex.exec(text)) !== null) {
          const raw = match[0];
          let latex = "";
          let isDisplay = false;
          if (raw.startsWith("$$")) {
            // Double dollar display math: $$...$$
            latex = raw.slice(2, -2).trim();
            isDisplay = true;
          } else if (raw.startsWith("$")) {
            // Single dollar inline math: $...$
            latex = raw.slice(1, -1).trim();
            isDisplay = false;
          } else if (raw.startsWith("\\[")) {
            latex = raw.slice(2, -2);
            isDisplay = true;
          } else if (raw.startsWith("\\(")) {
            latex = raw.slice(2, -2);
            isDisplay = false;
          } else {
            latex = raw;
            isDisplay = false;
          }
          
          if (match.index > lastIndex) {
            segments.push({ type: "text", value: text.slice(lastIndex, match.index) });
          }
          segments.push({ type: "latex", latex: latex.trim(), raw, isDisplay });
          lastIndex = match.index + raw.length;
        }
        if (!segments.length) continue;
        if (lastIndex < text.length) {
          segments.push({ type: "text", value: text.slice(lastIndex) });
        }

        const frag = document.createDocumentFragment();
        for (const seg of segments) {
          if (seg.type === "text") {
            frag.appendChild(document.createTextNode(seg.value));
            continue;
          }
          // Use display mode for cache key if it's display math
          const cacheKey = seg.isDisplay ? `display:${seg.latex}` : `inline:${seg.latex}`;
          let conv = cache.get(cacheKey);
          if (!conv) {
            try {
              const mathml = await latexToMathml(seg.latex, seg.isDisplay);
              conv = { mathml };
              cache.set(cacheKey, conv);
            } catch (e) {
              logWarn("latex convert failed", e);
              if (
                IS_TEST_PAGE &&
                document.documentElement &&
                document.documentElement.dataset &&
                document.documentElement.dataset.copyOfficeFormatForceWasm === "true"
              ) {
                throw e;
              }
              frag.appendChild(document.createTextNode(seg.raw));
              continue;
            }
          }
          const span = document.createElement("span");
          span.className = "math-mathml";
          span.style.cssText = "display:inline-block;";
          appendStringAsNodes(span, conv.mathml);
          frag.appendChild(span);
        }

        node.parentNode.replaceChild(frag, node);
      }
    }
  }

  // Safe HTML parsing to prevent XSS
  function safeParseHtml(html) {
    // Use DOMParser for safer parsing
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    // Check for parse errors
    const parseError = doc.querySelector("parsererror");
    if (parseError) {
      // Fallback: strip HTML and escape
      const div = document.createElement("div");
      div.textContent = html;
      return div;
    }
    return doc.body;
  }

  function appendStringAsNodes(container, xmlString) {
    // Use safer parsing instead of innerHTML
    try {
      const body = safeParseHtml(xmlString);
      while (body.firstChild) {
        container.appendChild(body.firstChild);
      }
    } catch (e) {
      // Fallback for XML strings (MathML/OMML)
      const parser = new DOMParser();
      try {
        const xmlDoc = parser.parseFromString(xmlString, "application/xml");
        const parseError = xmlDoc.querySelector("parsererror");
        if (parseError) {
          logWarn("XML parse error:", parseError.textContent);
          // Fallback to text node
          container.appendChild(document.createTextNode(xmlString));
        } else {
          // Clone nodes from XML document
          const fragment = document.createDocumentFragment();
          const walker = document.createTreeWalker(xmlDoc, NodeFilter.SHOW_ALL, null);
          let node;
          while (node = walker.nextNode()) {
            if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE) {
              fragment.appendChild(node.cloneNode(true));
            }
          }
          container.appendChild(fragment);
        }
        } catch (xmlErr) {
          logWarn("Failed to parse XML:", xmlErr);
          // Last resort: text node
          container.appendChild(document.createTextNode(xmlString));
        }
    }
  }

  function stripMathmlAnnotations(mathml) {
    // KaTeX/MathML often includes TeX source in <annotation encoding="application/x-tex">...</annotation>.
    // Keeping that leaks raw TeX into clipboard/docx and can create duplicate “formula as text” artifacts.
    try {
      return String(mathml || "").replace(/<annotation\b[\s\S]*?<\/annotation>/gi, "");
    } catch {
      return String(mathml || "");
    }
  }

  function isExcluded(node, excludeTags) {
    let p = node.parentElement;
    while (p) {
      if (excludeTags.has(p.tagName)) return true;
      p = p.parentElement;
    }
    return false;
  }

  async function writeClipboard(htmlContent, plainText) {
    log("writeClipboard called");
    log("HTML content length:", htmlContent ? htmlContent.length : 0);
    log("Plain text length:", plainText ? plainText.length : 0);

    // Test pages: capture payload deterministically and avoid real clipboard permission prompts.
    if (IS_TEST_PAGE) {
      const wrapped = wrapHtmlDoc(htmlContent);
      const cfhtml = buildCfHtml(wrapped, location.href);
      lastClipboardPayload = {
        cfhtml,
        wrappedHtml: wrapped,
        plainText,
        via: "test-bridge",
        timestamp: Date.now()
      };
      updateTestBridge();
      return;
    }

    const wrapped = wrapHtmlDoc(htmlContent);
    
    // Feature detection
    if (!navigator.clipboard || !navigator.clipboard.write) {
      logError("Clipboard API not available");
      throw new Error("Clipboard API not available");
    }
    
    if (typeof ClipboardItem === 'undefined') {
      logWarn("ClipboardItem not available, using fallback");
      if (IS_TEST_PAGE && typeof window !== 'undefined' && window.__copyOfficeFormatExtension) {
        window.__copyOfficeFormatExtension.lastClipboard = {
          cfhtml: buildCfHtml(wrapped, location.href),
          wrappedHtml: wrapped,
          plainText,
          via: "execCommand-fallback",
          timestamp: Date.now()
        };
      }
      if (IS_TEST_PAGE) {
        lastClipboardPayload = {
          cfhtml: buildCfHtml(wrapped, location.href),
          wrappedHtml: wrapped,
          plainText,
          via: "execCommand-fallback",
          timestamp: Date.now()
        };
        updateTestBridge();
      }
      fallbackExecCopy(wrapped, plainText);
      return;
    }
    
    const cfhtml = buildCfHtml(wrapped, location.href);
    log("CF_HTML length:", cfhtml.length);

    if (IS_TEST_PAGE && typeof window !== 'undefined' && window.__copyOfficeFormatExtension) {
      window.__copyOfficeFormatExtension.lastClipboard = {
        cfhtml,
        wrappedHtml: wrapped,
        plainText,
        via: "navigator.clipboard.write",
        timestamp: Date.now()
      };
    }
    if (IS_TEST_PAGE) {
      lastClipboardPayload = {
        cfhtml,
        wrappedHtml: wrapped,
        plainText,
        via: "navigator.clipboard.write",
        timestamp: Date.now()
      };
      updateTestBridge();
    }
    
    // IMPORTANT:
    // - The Web Clipboard API expects *HTML*, not Windows CF_HTML headers.
    // - Browsers on Windows will translate "text/html" to the OS "HTML Format" clipboard entry.
    // If we put CF_HTML (Version:1.0/StartHTML/StartFragment...) into "text/html", apps like Word
    // can end up pasting the header verbatim as plain text.
    const payload = {
      "text/html": new Blob([wrapped], { type: "text/html" }),
      "text/plain": new Blob([plainText], { type: "text/plain" }),
    };
    
    try {
      log("Creating ClipboardItem...");
      const item = new ClipboardItem(payload);
      log("Writing to clipboard...");
      await navigator.clipboard.write([item]);
      log("✅ Clipboard write successful");
    } catch (err) {
      logError("Clipboard write error:", err);
      logError("Error name:", err.name);
      logError("Error message:", err.message);
      if (err.name === "NotAllowedError") {
        logError("Clipboard permission denied - user gesture may be required");
        throw new Error(CONFIG.MESSAGES.CLIPBOARD_DENIED);
      }
      logWarn("Async clipboard failed, falling back to execCommand", err);
      try {
        fallbackExecCopy(wrapped, plainText);
        log("✅ Fallback execCommand copy successful");
      } catch (fallbackErr) {
        logError("Fallback copy also failed:", fallbackErr);
        throw fallbackErr;
      }
    }
  }

  function buildCfHtml(fullHtml, sourceUrl = "") {
    // CF_HTML offsets are byte offsets of the encoded payload.
    // Use UTF-8 byte lengths to match how Windows clipboard consumers (e.g., Word) parse CF_HTML.
    const startFragMarker = "<!--StartFragment-->";
    const endFragMarker = "<!--EndFragment-->";
    const html = `${startFragMarker}${fullHtml}${endFragMarker}`;

    const encoder = new TextEncoder();
    const utf8ByteLength = (str) => encoder.encode(str).length;
    
    const srcLine = sourceUrl ? `SourceURL:${sourceUrl}\r\n` : "";
    const placeholder = "0000000000";
    let header =
      `Version:1.0\r\n` +
      `StartHTML:${placeholder}\r\n` +
      `EndHTML:${placeholder}\r\n` +
      `StartFragment:${placeholder}\r\n` +
      `EndFragment:${placeholder}\r\n` +
      srcLine;

    // Calculate offsets using UTF-8 byte lengths.
    const headerBytes = utf8ByteLength(header);
    const startHTML = headerBytes;
    const startFragment = startHTML + utf8ByteLength(startFragMarker);
    const endFragment = startFragment + utf8ByteLength(fullHtml);
    const endHTML = startHTML + utf8ByteLength(html);

    const pad = (n) => n.toString().padStart(10, "0");
    header =
      `Version:1.0\r\n` +
      `StartHTML:${pad(startHTML)}\r\n` +
      `EndHTML:${pad(endHTML)}\r\n` +
      `StartFragment:${pad(startFragment)}\r\n` +
      `EndFragment:${pad(endFragment)}\r\n` +
      srcLine;

    return header + html;
  }

  function fallbackExecCopy(htmlString, plain) {
    // Note: execCommand('copy') is deprecated but still used as fallback
    // TODO: Monitor deprecation and plan alternative
    const div = document.createElement("div");
    div.contentEditable = "true";
    div.style.position = "fixed";
    div.style.left = "-9999px";
    // Use safer HTML parsing
    const body = safeParseHtml(htmlString);
    div.replaceChildren(...body.childNodes);
    
    try {
      document.body.appendChild(div);
      const range = document.createRange();
      range.selectNodeContents(div);
      const sel = window.getSelection();
      const savedRanges = [];
      // Save current selection
      for (let i = 0; i < sel.rangeCount; i++) {
        savedRanges.push(sel.getRangeAt(i).cloneRange());
      }
      sel.removeAllRanges();
      sel.addRange(range);
      
      const success = document.execCommand("copy");
      sel.removeAllRanges();
      
      // Restore original selection
      for (const savedRange of savedRanges) {
        try {
          sel.addRange(savedRange);
        } catch (e) {
          // Range may be invalid, ignore
        }
      }
      
      div.remove();
      
      if (!success) {
        throw new Error("execCommand('copy') returned false");
      }
      
      // Do not overwrite the clipboard with writeText(): it can erase richer formats (HTML).
    } catch (err) {
      logError("Fallback copy failed:", err);
      // Ensure cleanup
      try {
        div.remove();
      } catch (e) {
        // Ignore cleanup errors
      }
      throw err;
    }
  }

  function wrapHtmlDoc(fragment) {
    // IMPORTANT: Keep this as normal HTML. Do not set a default XML namespace (e.g. MathML) on <html>,
    // because some consumers (notably LibreOffice) appear to treat the clipboard HTML as XML and will
    // reject/strip content when the whole document is in the MathML namespace.
    return `<html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`;
  }

  function combineFragments(ommlParts, mathmlParts) {
    const result = [];
    for (let i = 0; i < ommlParts.length; i++) {
      const omml = ommlParts[i] || "";
      const mathml = mathmlParts[i] || "";
      result.push(`<span style="mso-element:omath; display:inline-block;">${omml}${mathml}</span>`);
    }
    return result.join("");
  }

  function stripTags(html) {
    // Use safer parsing
    const body = safeParseHtml(html);
    return body.textContent || "";
  }

  function escapeHtml(str) {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function notify(msg) {
    if (DEBUG) {
      console.info(`[Copy as Office Format] ${msg}`);
    }
    // Also try to show a visual notification if possible
    try {
      // Create a temporary notification element
      const notification = document.createElement("div");
      notification.style.cssText = "position:fixed;top:20px;right:20px;background:#4CAF50;color:white;padding:12px 20px;border-radius:4px;z-index:10000;font-family:sans-serif;box-shadow:0 2px 8px rgba(0,0,0,0.2);";
      notification.textContent = msg;
      document.body.appendChild(notification);
      setTimeout(() => notification.remove(), CONFIG.NOTIFICATION_DURATION);
    } catch (e) {
      // Ignore if DOM manipulation fails
    }
  }

  // Always expose extension marker for testing (not just in DEBUG mode)
  // This allows automated tests to reliably detect if extension is loaded
  if (typeof window !== 'undefined') {
    if (IS_TEST_PAGE) {
      ensureTestBridge();
      updateTestBridge();
    }

    window.__copyOfficeFormatExtension = {
      version: '0.2.0',
      loaded: true,
      ready: true,
      isTestPage: IS_TEST_PAGE,
      lastPayload: null,
      lastClipboard: null,
      checkStatus: function() {
        return {
          extensionLoaded: typeof browser !== 'undefined' && typeof browser.runtime !== 'undefined',
          mathJaxLoaded: mathJaxLoadPromise !== null,
          xsltLoaded: xsltPromise !== null,
          selection: (() => {
            const sel = window.getSelection();
            if (!sel || sel.rangeCount === 0) return null;
            return {
              text: sel.toString(),
              htmlLength: getSelectionHtml().length,
              textLength: getSelectionText().length
            };
          })()
        };
      }
    };

    if (IS_TEST_PAGE) {
      window.addEventListener("__copyOfficeFormatTestRequest", async (event) => {
        const detail = (event && event.detail) ? event.detail : {};
        const requestId = detail.requestId || null;

        try {
          if (detail.selector && typeof detail.selector === "string") {
            const element = document.querySelector(detail.selector);
            if (element) {
              const range = document.createRange();
              range.selectNodeContents(element);
              const selection = window.getSelection();
              selection.removeAllRanges();
              selection.addRange(range);
              try {
                document.documentElement.dataset.copyOfficeFormatTestSelectorFound = "true";
                document.documentElement.dataset.copyOfficeFormatTestSelectionLength = String(selection.toString().length);
              } catch {
                // ignore
              }
            } else {
              try {
                document.documentElement.dataset.copyOfficeFormatTestSelectorFound = "false";
              } catch {
                // ignore
              }
            }
          }

          await handleCopy();
          updateTestBridge();
          window.dispatchEvent(new CustomEvent("__copyOfficeFormatTestResult", { detail: { requestId, ok: true } }));
        } catch (e) {
          updateTestBridge();
          window.dispatchEvent(new CustomEvent("__copyOfficeFormatTestResult", {
            detail: { requestId, ok: false, error: e && e.message ? e.message : String(e) }
          }));
        }
      });
    }
    
    if (DEBUG) {
      console.log('[Copy as Office Format] Extension content script loaded');
    }
    
    // Expose test function to window for debugging (only in development)
    // Usage in console: window.testCopyOfficeFormat()
    if (DEBUG) {
      window.testCopyOfficeFormat = function() {
        log("Test function called from console");
        return handleCopy();
      };
      
      window.checkExtensionStatus = function() {
        const status = window.__copyOfficeFormatExtension.checkStatus();
        log("Extension Status:", status);
        return status;
      };
      
      log("Debug functions available:");
      log("  - window.testCopyOfficeFormat() - Test copy function");
      log("  - window.checkExtensionStatus() - Check extension status");
    }
  }
})();
