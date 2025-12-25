(() => {
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
  const DEBUG = true; // Set to true for debugging - ENABLED FOR TROUBLESHOOTING
  
  const log = DEBUG ? console.log.bind(console, "[Copy as Office Format]") : () => {};
  const logError = console.error.bind(console, "[Copy as Office Format]");
  const logWarn = DEBUG ? console.warn.bind(console, "[Copy as Office Format]") : () => {};

  let mathJaxLoadPromise = null;
  let xsltPromise = null;

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
      await ensureMathTools();
      
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
            const mathml = await MathJax.tex2mmlPromise(tex, { display: isDisplay });
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
      
      log("Calling writeClipboard...");
      await writeClipboard(processedHtml, plainText);
      log("✅ Copy completed successfully");
      notify(CONFIG.MESSAGES.COPY_SUCCESS);
    } catch (err) {
      logError("❌ Copy failed:", err);
      logError("Error stack:", err.stack);
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
      /(?<!\\)\$\$(.+?)(?<!\\)\$\$/g,  // Display: $$...$$ (double dollar - check first!)
      /\\\[.*?\\\]/g,                   // Display: \[...\]
      /\\\(.*?\\\)/g,                   // Inline: \(...\)
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
    // Add timeout wrapper for conversion
    // Use bridge function injected into page context (MathJax runs in page context, not isolated content script context)
    if (typeof window.__mathjaxConvert === 'function') {
      log("📞 Calling MathJax bridge function for conversion...");
      return Promise.race([
        window.__mathjaxConvert(latex, display),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error(CONFIG.MESSAGES.LATEX_CONVERSION_TIMEOUT || "LaTeX to MathML conversion timeout")), CONFIG.LATEX_TO_MATHML_TIMEOUT)
        )
      ]);
    } else {
      // Fallback: try direct access (might work if MathJax is in same context)
      log("⚠️ Bridge function not available, trying direct MathJax access...");
      if (typeof MathJax !== 'undefined' && typeof MathJax.tex2mmlPromise === 'function') {
        return Promise.race([
          MathJax.tex2mmlPromise(latex, { display: display }),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error(CONFIG.MESSAGES.LATEX_CONVERSION_TIMEOUT || "LaTeX to MathML conversion timeout")), CONFIG.LATEX_TO_MATHML_TIMEOUT)
          )
        ]);
      } else {
        throw new Error("MathJax bridge not available and MathJax not accessible");
      }
    }
  }

  async function latexToOmml(latex) {
    // Feature detection
    if (typeof XSLTProcessor === 'undefined') {
      throw new Error("XSLTProcessor not available");
    }
    
    // Add timeout wrapper
    return Promise.race([
      (async () => {
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
    if (!html || (!html.includes("$") && !html.includes("\\[") && !html.includes("$$"))) {
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
    const latexRegex = /(\\\[.*?\\\]|\\\(.*?\\\)|\\begin\{.*?\}[\s\S]*?\\end\{.*?\}|\$\$(.+?)\$\$|\$(.+?)\$)/g;

    await processRoot(ommlRoot);

    return { visualHtml: html, ommlHtml: ommlRoot.innerHTML };

    async function processRoot(root) {
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
              let omml = "";
              try {
                omml = await latexToOmml(seg.latex);
              } catch (_) {
                omml = mathml;
              }
              conv = { mathml, omml };
              cache.set(cacheKey, conv);
            } catch (e) {
              logWarn("latex convert failed", e);
              frag.appendChild(document.createTextNode(seg.raw));
              continue;
            }
          }
          const span = document.createElement("span");
          span.className = "math-omml";
          span.style.cssText = "mso-element:omath; display:inline-block;";
          appendStringAsNodes(span, conv.omml || conv.mathml);
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
    
    // Feature detection
    if (!navigator.clipboard || !navigator.clipboard.write) {
      logError("Clipboard API not available");
      throw new Error("Clipboard API not available");
    }
    
    if (typeof ClipboardItem === 'undefined') {
      logWarn("ClipboardItem not available, using fallback");
      const wrapped = wrapHtmlDoc(htmlContent);
      fallbackExecCopy(wrapped, plainText);
      return;
    }
    
    const wrapped = wrapHtmlDoc(htmlContent);
    const cfhtml = buildCfHtml(wrapped, location.href);
    log("CF_HTML length:", cfhtml.length);
    
    const payload = {
      "text/html": new Blob([cfhtml], { type: "text/html" }),
      "text/plain": new Blob([plainText], { type: "text/plain" })
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
    // CF_HTML specification requires UTF-16 encoding for byte offsets
    const startFragMarker = "<!--StartFragment-->";
    const endFragMarker = "<!--EndFragment-->";
    const html = `${startFragMarker}${fullHtml}${endFragMarker}`;
    
    // Calculate UTF-16 byte length (CF_HTML spec requirement)
    function utf16ByteLength(str) {
      let length = 0;
      for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);
        // Surrogate pairs (code > 0xFFFF) take 4 bytes, others take 2 bytes
        length += code > 0xFFFF ? 4 : 2;
      }
      return length;
    }
    
    const srcLine = sourceUrl ? `SourceURL:${sourceUrl}\r\n` : "";
    const placeholder = "0000000000";
    let header =
      `Version:1.0\r\n` +
      `StartHTML:${placeholder}\r\n` +
      `EndHTML:${placeholder}\r\n` +
      `StartFragment:${placeholder}\r\n` +
      `EndFragment:${placeholder}\r\n` +
      srcLine;

    // Calculate offsets using UTF-16 encoding
    const headerBytes = utf16ByteLength(header);
    const startHTML = headerBytes;
    const startFragment = startHTML + utf16ByteLength(startFragMarker);
    const endFragment = startFragment + utf16ByteLength(fullHtml);
    const endHTML = startHTML + utf16ByteLength(html);

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
      
      // Best-effort plain text copy
      try {
        navigator.clipboard.writeText(plain);
      } catch (clipboardErr) {
        logWarn("Plain text clipboard write failed:", clipboardErr);
      }
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
    return `<html xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns="http://www.w3.org/1998/Math/MathML"><body>${fragment}</body></html>`;
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
    window.__copyOfficeFormatExtension = {
      version: '0.2.0',
      loaded: true,
      ready: true,
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
