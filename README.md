# GPT LATEX Ctrl-C Ctrl-V

Firefox extension that copies your current selection as **Office-friendly HTML** and converts math into **real Word equations** (MathML -> OMML on paste).

Design principle: deterministic, inspectable pipeline (selection HTML via `Range.cloneContents()`, clipboard writes via `navigator.clipboard.*` / MV3 offscreen writer; no native copy triggers).

It also supports:

- **Copy as Markdown** (writes Markdown to the clipboard)
- **Copy as Office Format (Markdown selection)** (renders selected Markdown -> HTML -> Office HTML)
- **Copy selection HTML** (writes the selected HTML fragment to the clipboard as `text/html`, without Word wrappers)
- **Translation on Copy** (Ctrl-C) - Translate content before copying using multiple services (Google, Microsoft, ChatGPT, Gemini, Pollinations, Custom API)
- **Formula/Code Protection** - Automatically protects formulas and code from translation
- **Content Analysis** - Semantic embeddings and word frequency analysis for better translation

## Repository layout

- `extension/` - the Firefox MV2 extension source (upload this to AMO).
- `examples/` - offline fixtures (Gemini + ChatGPT captures used for deterministic testing).
- `tests/` - Playwright automation + (optional) Word paste verification.
- `tools/` - build and probe scripts.
- `rust/` - Rust -> WASM converters used by the content script.

## Quick start (dev)

### Initialize Development Environment

**Windows:**
```cmd
tools\init.cmd
```

**Unix/Linux/Mac:**
```bash
chmod +x tools/init.sh
./tools/init.sh
```

This will:
- Check and install Python dependencies (`uv sync`)
- Install Playwright browsers
- Verify build tools
- Optionally build WASM module (if Rust is installed)

### Run Tests

Single entry point (recommended):

```powershell
uv run python tests/run_all.py --fast
```

Full suite (may overwrite clipboard on Windows):

```powershell
uv run python tests/run_all.py --include-large
```

Useful flags:

```powershell
uv run python tests/run_all.py --include-large --fail-fast
uv run python tests/run_all.py --fast --skip-translation-unit
```

**Windows:**
```cmd
tests\run_tests.bat
```

**Unix/Linux/Mac:**
```bash
./tests/run_tests.sh
```

`tests/run_tests.*` delegates to `tests/run_all.py`.

## Real clipboard tests (Windows)

These generate inspectable artifacts under `test_results/` and overwrite your clipboard while running.

```powershell
uv run python tests/test_real_clipboard_payloads.py --out-root test_results\clipboard_direct
uv run python tests/test_real_clipboard_docx.py --out-root test_results\real_clipboard
uv run python tests/test_real_clipboard_markdown.py --out-root test_results\real_clipboard_markdown
```

`test_real_clipboard_payloads.py` verifies the **raw clipboard payloads** (CF_HTML fragment + CF_UNICODETEXT) for each copy mode without involving Word/docx.

`test_real_clipboard_docx.py` writes a per-case `final.docx` under `test_results\real_clipboard\<case>\final.docx` (and also keeps `docx_from_clipboard.docx` plus `docx_from_word_paste.docx` when Word is available).

## Translation debugging

When translation “does nothing”, open DevTools Console on the page you’re copying from and look for logs prefixed with `[GPT LATEX Ctrl-C Ctrl-V] translationDebug ...` (they include service, target language, gating reasons, and network status without printing your copied text). This runs for **Copy as Office Format** when translation is enabled, and for **Ctrl‑C** only when `Intercept Ctrl-C` is enabled.

## Build an XPI/ZIP for AMO

AMO expects a ZIP (or XPI) with `manifest.json` at the archive root.

```powershell
uv run python tools/build_rust_wasm.py
uv run python tools/build_firefox_xpi.py --out dist/gpt-latex-ctrl-c-v.xpi
```

## Privacy

This extension does not intentionally send your copied content anywhere; it operates locally in the browser and writes to the clipboard. See `docs/PRIVACY.md`.

## Documentation

- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** - Project architecture and design
- **[docs/diagram.md](docs/diagram.md)** - Workflow diagrams (build, runtime, testing)
- **`docs/reports/`** - Release/testing reports and verification guides
- **[docs/AMO_SUBMISSION.md](docs/AMO_SUBMISSION.md)** - AMO submission checklist
- **[docs/testing/README.md](docs/testing/README.md)** - Testing documentation
- **[docs/debugging/](docs/debugging/)** - Debugging guides

## Publishing notes

See `docs/AMO_SUBMISSION.md` for a checklist (permissions, extension ID, packaging).

## License

MIT. See `LICENSE`.
