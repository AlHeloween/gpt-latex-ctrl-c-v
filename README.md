# Copy as Office Format

Firefox extension that copies your current selection as **Office-friendly HTML** and converts math into **real Word equations** (MathML -> OMML on paste).

It also supports:

- **Copy as Markdown** (writes Markdown to the clipboard)
- **Copy as Office Format (Markdown selection)** (renders selected Markdown -> HTML -> Office HTML)

## Repository layout

- `extension/` - the Firefox MV2 extension source (upload this to AMO).
- `examples/` - offline fixtures (Gemini + ChatGPT captures used for deterministic testing).
- `tests/` - Playwright automation + (optional) Word paste verification.
- `lib/tools/` - build and probe scripts.
- `lib/rust/` - Rust -> WASM converters used by the content script.

## Quick start (dev)

```powershell
uv sync
uv run playwright install chromium
.\tests\run_tests.bat
```

`tests/run_tests.*` does not write persistent artifacts by default.

## Real clipboard tests (Windows)

These generate inspectable artifacts under `test_results/` and overwrite your clipboard while running.

```powershell
uv run python tests/test_real_clipboard_docx.py --out-root test_results\real_clipboard
uv run python tests/test_real_clipboard_markdown.py --out-root test_results\real_clipboard_markdown
```

## Build an XPI/ZIP for AMO

AMO expects a ZIP (or XPI) with `manifest.json` at the archive root.

```powershell
uv run python lib/tools/build_rust_wasm.py
uv run python lib/tools/build_firefox_xpi.py --out dist/copy-as-office-format.xpi
```

## Privacy

This extension does not intentionally send your copied content anywhere; it operates locally in the browser and writes to the clipboard. See `docs/PRIVACY.md`.

## Publishing notes

See `docs/AMO_SUBMISSION.md` for a checklist (permissions, extension ID, packaging).

## License

MIT. See `LICENSE`.
