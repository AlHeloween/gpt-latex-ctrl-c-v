(() => {
  const cof = (globalThis.__cof = globalThis.__cof || {});
  const root = document?.documentElement;
  const ds = root?.dataset;
  const shouldLogDebug = () => {
    try {
      if (globalThis.__cofDebugLogsEnabled === true) return true;
      if (!ds) return false;
      return String(ds.copyOfficeFormatDebugLogs || "") === "true";
    } catch (_e) {
      return false;
    }
  };
  const toStr = (v) => {
    if (v && typeof v === "object" && typeof v.message === "string") return v.message;
    return String(v ?? "");
  };
  const diag = (k, v) => {
    try {
      const entry = { t: Date.now(), k: String(k || ""), v: toStr(v) };
      const arr = (globalThis.__cofLogs = globalThis.__cofLogs || []);
      if (Array.isArray(arr)) arr.push(entry);
      if (ds) ds[k] = toStr(v);
      const keyLower = String(k || "").toLowerCase();
      if (keyLower.includes("error")) {
        // Console is an inspectable artifact in tests and user debugging.
        console.error("[GPT LATEX Ctrl-C Ctrl-V]", entry.k, entry.v);
      }
      if (keyLower.includes("debug") && shouldLogDebug()) {
        console.log("[GPT LATEX Ctrl-C Ctrl-V]", entry.k, entry.v);
      }
    } catch (e) {
      globalThis.__cofDiagInternalError = toStr(e);
    }
  };
  globalThis.__cofDiag = diag;
  cof.diag = diag;
  if (ds) ds.copyOfficeFormatExtensionLoaded = "true";
})();
