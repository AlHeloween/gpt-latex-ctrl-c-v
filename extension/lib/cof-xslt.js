(() => {
  const cof = (globalThis.__cof = globalThis.__cof || {});
  const diag = cof.diag || (() => {});
  const core = cof.core || {};

  let xsltP = null;
  async function xsltDoc() {
    if (xsltP) return xsltP;
    xsltP = (async () => {
      const url = core.browserApi.runtime.getURL("assets/mathml2omml.xsl");
      const r = await fetch(url);
      if (!r.ok) throw new Error(`xslt fetch failed: ${r.status}`);
      const txt = await r.text();
      const doc = new DOMParser().parseFromString(txt, "application/xml");
      if (doc.querySelector("parsererror")) throw new Error("xslt parse error");
      return doc;
    })();
    return xsltP;
  }

  void xsltDoc().catch((e) => diag("copyOfficeFormatLastXsltError", e));

  function normalizeMathmlNamespaces(html) {
    const s = String(html || "");
    if (!s.includes("<math")) return s;
    return s.replace(
      /<math(?![^>]*\bxmlns=)[^>]*>/gi,
      (m) => m.replace("<math", '<math xmlns="http://www.w3.org/1998/Math/MathML"'),
    );
  }

  async function convertMathmlToOmmlInHtmlString(htmlString) {
    const s = String(htmlString || "");
    if (!s || typeof XSLTProcessor === "undefined") return s;
    let xslt;
    try {
      xslt = await xsltDoc();
    } catch (e) {
      diag("copyOfficeFormatLastXsltError", e);
      return s;
    }

    const normalized = normalizeMathmlNamespaces(s);
    const rx = /<math\b[\s\S]*?<\/math>/gi;
    let last = 0;
    const parts = [];
    for (;;) {
      const m = rx.exec(normalized);
      if (!m) break;
      const match = m[0];
      const start = m.index;
      parts.push(normalized.slice(last, start));
      let wrapped = match;
      try {
        const proc = new XSLTProcessor();
        proc.importStylesheet(xslt);
        const mathmlDoc = new DOMParser().parseFromString(match, "application/xml");
        if (!mathmlDoc.querySelector("parsererror")) {
          const ommlDoc = proc.transformToDocument(mathmlDoc);
          if (ommlDoc?.documentElement) {
            const omml = new XMLSerializer().serializeToString(ommlDoc.documentElement);
            const isBlock = /\bdisplay\s*=\s*["']block["']/i.test(match);
            const style = isBlock
              ? "mso-element:omath; display:block;"
              : "mso-element:omath; display:inline-block;";
            const ms = `<!--[if gte msEquation 12]>${omml}<![endif]-->`;
            const fb = `<![if !msEquation]>${match}<![endif]>`;
            wrapped = `<span style="${style}">${ms}${fb}</span>`;
          }
        }
      } catch (e) {
        diag("copyOfficeFormatLastXsltError", e);
      }
      parts.push(wrapped);
      last = start + match.length;
    }
    parts.push(normalized.slice(last));
    return parts.join("");
  }

  cof.xslt = { convertMathmlToOmmlInHtmlString };
})();
