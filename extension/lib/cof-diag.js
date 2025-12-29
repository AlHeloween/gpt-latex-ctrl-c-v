(() => {
  const cof = (globalThis.__cof = globalThis.__cof || {});
  const root = document?.documentElement;
  const ds = root?.dataset;
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
      if (String(k || "").toLowerCase().includes("error")) {
        // Console is an inspectable artifact in tests and user debugging.
        console.error("[Copy as Office Format]", entry.k, entry.v);
      }
    } catch (e) {
      globalThis.__cofDiagInternalError = toStr(e);
    }
  };
  globalThis.__cofDiag = diag;
  cof.diag = diag;
  if (ds) ds.copyOfficeFormatExtensionLoaded = "true";
})();
