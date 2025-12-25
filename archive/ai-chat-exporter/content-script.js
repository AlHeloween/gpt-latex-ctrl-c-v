(() => {
  let mathJaxLoaded = false;
  let xsltPromise = null;

  browser.runtime.onMessage.addListener((msg) => {
    if (msg.type === "EXPORT_CHAT") {
      handleExport(msg.mode || "copy");
    }
  });

  async function handleExport(mode = "copy") {
    const { site, messages } = collectMessages(mode);
    if (!messages.length) {
      toast("No chat messages found on this page.");
      return;
    }
    const { htmlDocVisual, fragmentVisual, htmlDocOmml, fragmentOmml, plain } = await buildDocuments(messages);
    if (mode === "save") {
      await saveHtml(htmlDocVisual, site);
      return;
    }
    if (mode === "copy") {
      try {
        await writeClipboard(htmlDocOmml, fragmentOmml, plain);
        toast(`Copied ${messages.length} message${messages.length > 1 ? "s" : ""} from ${site}`);
      } catch (err) {
        console.error("clipboard write failed", err);
        toast("Copy failed; see console");
      }
    }
  }

  function collectMessages(mode = "copy") {
    const hostname = location.hostname;
    let site = "unknown";
    let messages = [];

    const selectionHtml = getSelectionHtml();
    const selectionText = (window.getSelection && window.getSelection().toString()) || "";
    if (mode === "copy-selection") {
      if (!selectionHtml || !selectionText.trim().length) {
        toast("No selection to copy.");
        return { site: "selection", messages: [] };
      }
      site = "selection";
      messages = [
        { role: "selection", html: selectionHtml, text: selectionText }
      ];
      return { site, messages };
    }

    if (selectionHtml && selectionText.trim().length) {
      site = "selection";
      messages = [
        {
          role: "selection",
          html: selectionHtml,
          text: selectionText
        }
      ];
      return { site, messages };
    }

    if (/chatgpt\.com|openai\.com/.test(hostname)) {
      site = "ChatGPT";
      messages = [...document.querySelectorAll("div[data-message-author-role]")].map((el) => ({
        role: el.getAttribute("data-message-author-role") || "assistant",
        html: el.innerHTML.trim(),
        text: el.innerText || el.textContent || ""
      }));
    } else if (/gemini\.google\.com/.test(hostname)) {
      site = "Gemini";
      messages = [...document.querySelectorAll("user-query-content, message-content")].map((el) => ({
        role: el.tagName.toLowerCase().includes("user") ? "user" : "assistant",
        html: el.innerHTML.trim(),
        text: el.innerText || el.textContent || ""
      }));
    } else if (/grok\.com/.test(hostname)) {
      site = "Grok";
      messages = [...document.querySelectorAll("div.message-bubble")].map((el) => ({
        role: el.classList.contains("user") ? "user" : "assistant",
        html: el.innerHTML.trim(),
        text: el.innerText || el.textContent || ""
      }));
    } else {
      const articles = [...document.querySelectorAll("article")];
      if (articles.length) {
        site = "article";
        messages = articles.map((el, idx) => ({
          role: idx % 2 === 0 ? "user" : "assistant",
          html: el.innerHTML.trim(),
          text: el.innerText || el.textContent || ""
        }));
      }
    }

    messages = messages.filter((m) => m.html || m.text);
    return { site, messages };
  }

  function getSelectionHtml() {
    const sel = window.getSelection && window.getSelection();
    if (!sel || sel.rangeCount === 0) return "";
    const range = sel.getRangeAt(0).cloneRange();
    const div = document.createElement("div");
    div.appendChild(range.cloneContents());
    return div.innerHTML.trim();
  }

  async function buildDocuments(messages) {
    await ensureMathTools();

    const visualBlocks = [];
    const ommlBlocks = [];
    for (const m of messages) {
      const role = m.role || "assistant";
      const { visualHtml, ommlHtml } = await convertLatexInHtml(m.html || "");
      visualBlocks.push(
        `<div class="msg msg-${role}"><div class="msg-role">${escapeHtml(role)}</div><div class="msg-body">${visualHtml}</div></div>`
      );
      ommlBlocks.push(
        `<div class="msg msg-${role}"><div class="msg-role">${escapeHtml(role)}</div><div class="msg-body">${ommlHtml}</div></div>`
      );
    }

    const styles = `
      body { font-family: "Segoe UI", system-ui, sans-serif; color: #111; background: #fff; }
      .chat { max-width: 960px; margin: 0 auto; padding: 12px; }
      .msg { border: 1px solid #e0e0e0; border-radius: 8px; padding: 8px 10px; margin: 6px 0; }
      .msg-user { background: #f5f7ff; }
      .msg-assistant { background: #f9f9f9; }
      .msg-role { font-weight: 600; font-size: 12px; color: #444; margin-bottom: 4px; text-transform: capitalize; }
      pre { background: #f3f3f3; padding: 8px; border-radius: 6px; overflow: auto; }
      code { font-family: "SFMono-Regular", Consolas, monospace; }
      table { border-collapse: collapse; }
      td, th { border: 1px solid #ccc; padding: 4px 6px; }
      .math-vis { display: inline-block; }
    `;

    const fragmentVisual = `<div class="chat">${visualBlocks.join("\n")}</div>`;
    const fragmentOmml = `<div class="chat">${ommlBlocks.join("\n")}</div>`;

    const htmlDocVisual = `<!DOCTYPE html><html xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><head><meta charset="UTF-8"><style>${styles}</style></head><body>${fragmentVisual}</body></html>`;
    const htmlDocOmml = `<!DOCTYPE html><html xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><head><meta charset="UTF-8"><style>${styles}</style></head><body>${fragmentOmml}</body></html>`;

    const plain = messages
      .map((m) => `${(m.role || "assistant").toUpperCase()}: ${m.text || stripTags(m.html)}`)
      .join("\n\n");

    return { htmlDocVisual, fragmentVisual, htmlDocOmml, fragmentOmml, plain };
  }

  async function writeClipboard(htmlDocOmml, fragmentOmml, plain) {
    const cfhtml = buildCfHtml(htmlDocOmml, fragmentOmml, location.href);
    const payload = {
      "text/html": new Blob([cfhtml], { type: "text/html" }),
      "text/plain": new Blob([plain], { type: "text/plain" })
    };
    const item = new ClipboardItem(payload);
    try {
      await navigator.clipboard.write([item]);
    } catch (err) {
      console.warn("Async clipboard failed, falling back to execCommand", err);
      fallbackExecCopy(fragmentOmml, plain);
    }
  }

  async function saveHtml(htmlDoc, site = "chat") {
    try {
      await browser.runtime.sendMessage({
        type: "SAVE_FILE",
        filename: `chat-${site}-${Date.now()}.html`,
        data: htmlDoc
      });
      toast("Saved chat as HTML (choose location in download prompt).");
    } catch (err) {
      console.error("save failed", err);
      toast("Save failed; see console");
    }
  }

  function buildCfHtml(fullHtml, fragmentHtml, sourceUrl = "") {
    const markerStart = "<!--StartFragment-->";
    const markerEnd = "<!--EndFragment-->";
    const markerWrapped = fullHtml.replace(fragmentHtml, `${markerStart}${fragmentHtml}${markerEnd}`);

    const encoder = new TextEncoder();
    const headerPlaceholder = "0000000000";
    const srcLine = sourceUrl ? `SourceURL:${sourceUrl}\r\n` : "";
    let header =
      `Version:1.0\r\n` +
      `StartHTML:${headerPlaceholder}\r\n` +
      `EndHTML:${headerPlaceholder}\r\n` +
      `StartFragment:${headerPlaceholder}\r\n` +
      `EndFragment:${headerPlaceholder}\r\n` +
      srcLine;

    const headerBytes = encoder.encode(header).length;
    const startHTML = headerBytes;
    const idxStartMarker = markerWrapped.indexOf(markerStart);
    const idxEndMarker = markerWrapped.indexOf(markerEnd);
    const startFragment = startHTML + encoder.encode(markerWrapped.slice(0, idxStartMarker)).length + encoder.encode(markerStart).length;
    const endFragment = startHTML + encoder.encode(markerWrapped.slice(0, idxEndMarker)).length;
    const endHTML = startHTML + encoder.encode(markerWrapped).length;

    const pad = (n) => n.toString().padStart(10, "0");
    header =
      `Version:1.0\r\n` +
      `StartHTML:${pad(startHTML)}\r\n` +
      `EndHTML:${pad(endHTML)}\r\n` +
      `StartFragment:${pad(startFragment)}\r\n` +
      `EndFragment:${pad(endFragment)}\r\n` +
      srcLine;

    return header + markerWrapped;
  }

  function fallbackExecCopy(fragmentHtml, plain) {
    const div = document.createElement("div");
    div.contentEditable = "true";
    div.style.position = "fixed";
    div.style.left = "-9999px";
    div.innerHTML = fragmentHtml;
    document.body.appendChild(div);
    const range = document.createRange();
    range.selectNodeContents(div);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand("copy");
    sel.removeAllRanges();
    div.remove();
    try {
      navigator.clipboard.writeText(plain);
    } catch (_) {}
  }

  function stripTags(html) {
    const div = document.createElement("div");
    div.innerHTML = html;
    return div.textContent || "";
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function toast(msg) {
    console.info(`[AI Chat Exporter] ${msg}`);
  }

  async function ensureMathTools() {
    if (!mathJaxLoaded) {
      mathJaxLoaded = true;
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = browser.runtime.getURL("mathjax/tex-mml-chtml.js");
        script.async = true;
        script.onload = () => MathJax.startup.promise.then(resolve).catch(reject);
        script.onerror = reject;
        document.documentElement.appendChild(script);
      });
    }
    if (!xsltPromise) {
      xsltPromise = fetch(browser.runtime.getURL("assets/mathml2omml.xsl"))
        .then((r) => r.text())
        .then((txt) => new DOMParser().parseFromString(txt, "application/xml"));
    }
    await xsltPromise;
  }

  async function latexToMathml(latex) {
    return MathJax.tex2mmlPromise(latex, { display: false });
  }

  async function latexToOmml(latex) {
    const mathml = await latexToMathml(latex);
    const xslt = await xsltPromise;
    const mathmlDoc = new DOMParser().parseFromString(mathml, "application/xml");
    const proc = new XSLTProcessor();
    proc.importStylesheet(xslt);
    const ommlDoc = proc.transformToDocument(mathmlDoc);
    return new XMLSerializer().serializeToString(ommlDoc.documentElement);
  }

  async function convertLatexInHtml(html) {
    if (!html || !html.includes("$")) return { visualHtml: html, ommlHtml: html };

    const visualRoot = document.createElement("div");
    visualRoot.innerHTML = html;
    const ommlRoot = document.createElement("div");
    ommlRoot.innerHTML = html;

    const exclude = new Set(["CODE", "PRE", "KBD", "SAMP", "TEXTAREA"]);
    const cache = new Map(); // latex -> {mathml, omml}
    const latexRegex = /(\\\[.*?\\\]|\\\(.*?\\\)|\\begin\{.*?\}[\\s\\S]*?\\end\{.*?\}|\$(.+?)\$)/g;

    await processRoot(visualRoot, "visual");
    await processRoot(ommlRoot, "omml");

    return { visualHtml: visualRoot.innerHTML, ommlHtml: ommlRoot.innerHTML };

    async function processRoot(root, mode) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      const textNodes = [];
      while (walker.nextNode()) textNodes.push(walker.currentNode);

      for (const node of textNodes) {
        const text = node.nodeValue;
        if (!text || !text.includes("$")) continue;
        if (isExcluded(node, exclude)) continue;

        latexRegex.lastIndex = 0;
        let match;
        let lastIndex = 0;
        const segments = [];
        while ((match = latexRegex.exec(text)) !== null) {
          const raw = match[0];
          const isDollar = raw.startsWith("$");
          const latex = isDollar ? raw.slice(1, -1) : raw.replace(/^\\\[|^\\\(|\\\]$|\\\)$/g, "");
          if (match.index > lastIndex) {
            segments.push({ type: "text", value: text.slice(lastIndex, match.index) });
          }
          segments.push({ type: "latex", latex, raw });
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
          let conv = cache.get(seg.latex);
          if (!conv) {
            try {
              const mathml = await latexToMathml(seg.latex);
              let omml = "";
              try {
                omml = await latexToOmml(seg.latex);
              } catch (_) {
                omml = mathml;
              }
              conv = { mathml, omml };
              cache.set(seg.latex, conv);
            } catch (e) {
              console.warn("latex convert failed", e);
              frag.appendChild(document.createTextNode(seg.raw));
              continue;
            }
          }
          const span = document.createElement("span");
          if (mode === "visual") {
            span.className = "math-vis";
            appendStringAsNodes(span, conv.mathml);
          } else {
            span.className = "math-omml";
            span.style.cssText = "mso-element:omath; display:inline-block;";
            appendStringAsNodes(span, conv.omml || conv.mathml);
          }
          frag.appendChild(span);
        }

        node.parentNode.replaceChild(frag, node);
      }
    }
  }

  function appendStringAsNodes(container, xmlString) {
    const tmp = document.createElement("div");
    tmp.innerHTML = xmlString;
    while (tmp.firstChild) {
      container.appendChild(tmp.firstChild);
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
})();
