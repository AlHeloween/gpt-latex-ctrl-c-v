# Copy as Office Format

Firefox extension that copies your current selection as **Office-friendly HTML** (CF_HTML) and converts math into **real Word equations** (MathML -> OMML on paste).

## Repository layout
- `extension/` - the Firefox MV2 extension source (this is what you upload to AMO).
- `examples/` - offline fixtures (Gemini + ChatGPT captures used for deterministic testing).
- `tests/` - Playwright automation + (optional) Word paste verification.
- `tools/` - build and probe scripts.
- `rust/` - Rust -> WASM TeX->MathML converter used by the content script.

## Quick start (dev)
```powershell
uv sync
uv run playwright install chromium
.\tests\run_tests.bat
```

`tests/run_tests.*` does not write persistent artifacts by default.

## Build an XPI/ZIP for AMO
AMO expects a ZIP (or XPI) with `manifest.json` at the archive root.

```powershell
uv run python tools/build_rust_wasm.py
uv run python tools/build_firefox_xpi.py --out dist/copy-as-office-format.xpi
```

## Privacy
This extension does not intentionally send your copied content anywhere; it operates locally in the browser and writes to the clipboard. See `docs/PRIVACY.md`.

## Publishing notes
See `docs/AMO_SUBMISSION.md` for a checklist (permissions, extension ID, packaging).

## License
MIT. See `LICENSE`.
