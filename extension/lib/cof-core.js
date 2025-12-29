(() => {
  const cof = (globalThis.__cof = globalThis.__cof || {});
  const diag = cof.diag || (() => {});
  const root = document?.documentElement || null;

  const IS_TEST = (() => {
    try {
      const p = String(location?.protocol || "");
      const h = String(location?.hostname || "");
      return (
        p === "file:" || h === "127.0.0.1" || h === "localhost" || h === ""
      );
    } catch (e) {
      diag("copyOfficeFormatNonFatalError", e);
      return false;
    }
  })();

  const browserApi = globalThis.browser ?? globalThis.chrome ?? null;
  if (!browserApi) diag("copyOfficeFormatNonFatalError", "browserApi missing");

  cof.core = { root, IS_TEST, browserApi };
})();
