# Clipboard Debugging (Deterministic)

This project intentionally avoids the browser’s native “copy selection” pipeline (letting the browser generate unknown HTML). Clipboard writes use explicit APIs (`navigator.clipboard.write([ClipboardItem])` / `navigator.clipboard.writeText`). If those APIs are unavailable or denied, the extension fails fast with a debuggable error instead of attempting opaque/native copy triggers.

## Quick Checklist

- Confirm the content script injected: `document.documentElement.dataset.copyOfficeFormatExtensionLoaded === "true"`.
- Confirm selection is non-empty: `window.getSelection()?.toString().trim().length > 0`.
- Trigger copy via a real user gesture (context menu) to satisfy clipboard requirements.

## Windows: Capture What Actually Hit the Clipboard

1. Perform the copy action.
2. Dump OS clipboard formats + extracted HTML fragment:

```powershell
uv run python tools/win_clipboard_dump.py --out-dir artifacts/clipboard_dump
```

3. Validate a captured CF_HTML payload (offsets + fragment markers):

```powershell
uv run python tools/validate_cf_html.py --in test.bin
```

## Deterministic Repro With Artifacts (Recommended)

- Office copy (real clipboard + Word paste + docx artifacts):

```powershell
uv run python tests/test_real_clipboard_docx.py --out-root test_results/real_clipboard
```

- Copy as Markdown (real clipboard text artifacts):

```powershell
uv run python tests/test_real_clipboard_markdown.py --out-root test_results/real_clipboard_markdown
```

Both tests only load `examples/*.html` and store per-case artifacts under `test_results/` (clipboard dump, extracted fragment/text, and poll logs).
