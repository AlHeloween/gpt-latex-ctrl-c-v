# GPT LATEX Ctrl-C Ctrl-V

Firefox extension that copies your current selection as **Office-friendly HTML** and converts math into **real Word equations** (MathML -> OMML on paste).

Design principle: deterministic, inspectable pipeline (selection HTML via `Range.cloneContents()`, clipboard writes via `navigator.clipboard.*` / MV3 offscreen writer; no native copy triggers).

It also supports:

- **Copy as Markdown** (writes Markdown to the clipboard)
- **Copy as Office Format (Markdown selection)** (renders selected Markdown -> HTML -> Office HTML)
- **Extract selected HTML** (processes HTML through normalization pipeline and extracts formatted plain text)
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
uv run python tests/test_real_clipboard_docx.py --out-root test_results\real_clipboard
uv run python tests/test_real_clipboard_markdown.py --out-root test_results\real_clipboard_markdown
```

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
- **[diagram.md](diagram.md)** - Workflow diagrams (build, runtime, testing)
- **[docs/AMO_SUBMISSION.md](docs/AMO_SUBMISSION.md)** - AMO submission checklist
- **[docs/testing/README.md](docs/testing/README.md)** - Testing documentation
- **[docs/debugging/](docs/debugging/)** - Debugging guides

## Publishing notes

See `docs/AMO_SUBMISSION.md` for a checklist (permissions, extension ID, packaging).

## License

MIT. See `LICENSE`.
