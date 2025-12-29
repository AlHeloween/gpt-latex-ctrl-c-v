(() => {
  const cof = (globalThis.__cof = globalThis.__cof || {});
  const diag = cof.diag || (() => {});
  const core = cof.core || {};

  function toast(msg, isError) {
    try {
      if (core.IS_TEST) return;
      const id = "__cof_toast";
      let el = document.getElementById(id);
      if (!el) {
        el = document.createElement("div");
        el.id = id;
        el.style.cssText =
          "position:fixed;right:16px;bottom:16px;z-index:2147483647;" +
          "padding:10px 12px;box-shadow:0 6px 18px #0003;" +
          "font:13px/1.3 system-ui,Arial,sans-serif;" +
          "background:#111827;color:#fff;";
        document.documentElement.appendChild(el);
      }
      el.textContent = String(msg || "");
      el.style.background = isError ? "#7f1d1d" : "#111827";
      const ms = Number(globalThis.CONFIG?.NOTIFICATION_DURATION) || 3000;
      clearTimeout(el.__cofTimer);
      el.__cofTimer = setTimeout(() => {
        try {
          el.remove();
        } catch (e) {
          diag("copyOfficeFormatNonFatalError", e);
        }
      }, ms);
    } catch (e) {
      diag("copyOfficeFormatNonFatalError", e);
    }
  }

  cof.ui = { toast };
})();
