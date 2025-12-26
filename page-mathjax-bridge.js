// Runs in the *page* context (loaded via web_accessible_resources).
// Purpose: provide a CSP-friendly MathJax loader + TeX->MathML converter for content scripts.
//
// Communication:
// - Request:  document.dispatchEvent(new CustomEvent("__copyOfficeFormatMathJaxRequest", {detail:{requestId, latex, display}}))
// - Response: document.dispatchEvent(new CustomEvent("__copyOfficeFormatMathJaxResponse", {detail:{requestId, ok, mathml|error}}))
//
// Status (for debugging / deterministic readiness):
// - document.documentElement.dataset.copyOfficeFormatMathJaxStatus = "loading" | "ready" | "error"
// - document.documentElement.dataset.copyOfficeFormatMathJaxError = "<message>"

(function () {
  try {
    const root = document.documentElement;
    const setStatus = (status, error) => {
      try {
        root.dataset.copyOfficeFormatMathJaxStatus = status;
        if (error) root.dataset.copyOfficeFormatMathJaxError = String(error);
      } catch (_) {
        // ignore
      }
    };

    if (window.__copyOfficeFormatMathJaxBridgeInstalled) {
      // Already installed; do not attach duplicate handlers.
      if (root.dataset.copyOfficeFormatMathJaxStatus === "ready") return;
    }
    window.__copyOfficeFormatMathJaxBridgeInstalled = true;

    setStatus("loading");

    const bridgeUrl = document.currentScript && document.currentScript.src ? String(document.currentScript.src) : "";
    const base = bridgeUrl ? bridgeUrl.replace(/\/[^/]*$/, "") : "";
    const mathJaxUrl = base ? `${base}/mathjax/tex-mml-chtml.js` : "";

    async function ensureMathJaxReady() {
      if (!window.MathJax) {
        if (!mathJaxUrl) throw new Error("Unable to resolve MathJax URL");

        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = mathJaxUrl;
          s.async = true;
          s.onload = () => resolve();
          s.onerror = () => reject(new Error("MathJax load failed"));
          (document.head || document.documentElement).appendChild(s);
        });
      }

      if (window.MathJax && window.MathJax.startup && window.MathJax.startup.promise) {
        await window.MathJax.startup.promise;
      }

      if (!window.MathJax || typeof window.MathJax.tex2mmlPromise !== "function") {
        throw new Error("MathJax methods not available");
      }
    }

    // Kick off load immediately so status becomes ready without waiting for the first request.
    ensureMathJaxReady()
      .then(() => setStatus("ready"))
      .catch((e) => setStatus("error", e && e.message ? e.message : e));

    document.addEventListener("__copyOfficeFormatMathJaxRequest", function (ev) {
      const d = ev && ev.detail ? ev.detail : {};
      const requestId = d.requestId || null;
      const latex = d.latex != null ? String(d.latex) : "";
      const display = !!d.display;

      function respond(ok, payload) {
        try {
          document.dispatchEvent(
            new CustomEvent("__copyOfficeFormatMathJaxResponse", {
              detail: Object.assign({ requestId: requestId, ok: ok }, payload || {}),
            })
          );
        } catch (_) {
          // ignore
        }
      }

      (async function () {
        try {
          await ensureMathJaxReady();
          const mathml = await window.MathJax.tex2mmlPromise(latex, { display: display });
          respond(true, { mathml: mathml });
        } catch (e) {
          setStatus("error", e && e.message ? e.message : e);
          respond(false, { error: e && e.message ? e.message : String(e) });
        }
      })();
    });
  } catch (e) {
    try {
      document.documentElement.dataset.copyOfficeFormatMathJaxStatus = "error";
      document.documentElement.dataset.copyOfficeFormatMathJaxError = e && e.message ? e.message : String(e);
    } catch (_) {
      // ignore
    }
  }
})();

