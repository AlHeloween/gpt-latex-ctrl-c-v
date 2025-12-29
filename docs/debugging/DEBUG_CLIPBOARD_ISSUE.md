# Debugging Clipboard Copy Issues

## Symptom

- The extension context-menu action runs, but clipboard output is empty/incorrect.

## Common Causes

1. Clipboard API permissions or user-gesture requirements.
2. Selection extraction failing (dynamic DOM updates, cross-frame selections, shadow DOM).
3. Conversion failure (malformed TeX/HTML, sanitizer stripping too much, unexpected tags).

## Quick Checks

1. Open DevTools Console (F12) and look for `[Copy as Office Format]` logs.
2. Verify the extension is loaded:
   - Firefox: `about:debugging` -> "This Firefox" -> Inspect the extension.
3. Repro with a simple page:
   - Open any file in `examples/`, select plain text, right-click -> "Copy as Office Format".

## Clipboard Sanity Test

Run in the page console:

```js
navigator.clipboard
  .writeText("clipboard-test")
  .then(() => navigator.clipboard.readText())
  .then((t) => console.log("OK:", t))
  .catch((e) => console.error("Clipboard error:", e));
```

## Next Step: Enable Debug Logs

- Set `DEBUG = true` in `extension/content-script.js`.
- Re-run the copy action and capture:
  - console logs
  - the extracted selection HTML (if logged)
  - any error stack traces
