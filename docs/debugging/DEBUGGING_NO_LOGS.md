# Debugging: No Visible Logs / “Copy failed”

## Goal

Debug using **deterministic, inspectable state**, not “maybe the console printed something”.

## Step 1: Verify the Content Script Loaded

Run:

```javascript
document.documentElement.dataset.copyOfficeFormatExtensionLoaded;
```

Expected: `"true"`.

## Step 2: Inspect Deterministic Failure Markers

After a failed copy attempt:

```javascript
document.documentElement.dataset.copyOfficeFormatLastStage;
document.documentElement.dataset.copyOfficeFormatLastCopyError;
document.documentElement.dataset.copyOfficeFormatWasmPreloadError;
document.documentElement.dataset.copyOfficeFormatLastClipboardWriteError;
document.documentElement.dataset.copyOfficeFormatLastBgSendError;
document.documentElement.dataset.copyOfficeFormatLastXsltError;
document.documentElement.dataset.copyOfficeFormatNonFatalError;
```

Meaning:

- `copyOfficeFormatLastStage`: `"wasm" | "xslt" | "clipboard" | "done"` (where it stopped)
- `copyOfficeFormatLastCopyError`: the user-visible failure reason
- `copyOfficeFormatWasmPreloadError`: WASM load/init failure (if any)
- `copyOfficeFormatLastClipboardWriteError`: `navigator.clipboard.*` error (if any)
- `copyOfficeFormatLastBgSendError`: `runtime.sendMessage` error (if any)
- `copyOfficeFormatLastXsltError`: MathML→OMML transform/XSLT error (if any)
- `copyOfficeFormatNonFatalError`: last non-fatal error captured during best-effort cleanup

## Step 3: Verify Messaging (Optional)

```javascript
browser.runtime
  .sendMessage({ type: "COPY_OFFICE_FORMAT", mode: "html" })
  .then((r) => console.log("Response:", r))
  .catch((e) => console.error("Error:", e));
```

## Step 4: Background Console (Firefox)

1. `about:debugging` → “This Firefox” → your extension → “Inspect”
2. Look for errors related to clipboard permissions / secure context.
