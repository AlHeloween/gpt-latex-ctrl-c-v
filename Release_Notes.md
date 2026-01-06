# Release Notes

## v0.2.0 (2026-01-06)

### Highlights

- Copy selections as **Office-friendly HTML** with **real Word equations** (MathML → OMML on paste).
- Deterministic copy pipeline: selection HTML via `Range.cloneContents()` and clipboard writes via `navigator.clipboard.*` / MV3 offscreen writer (no native copy triggers).
- Translation-on-copy pipeline with formula/code protection (anchors), chunking, progress diagnostics, and multiple providers.

### Copy modes

- Copy as Office Format (default)
- Copy as Office Format (Markdown selection)
- Copy as Markdown
- Copy selection HTML (exact selection fragment as `text/html`)

### Translation

- Pollinations (no API key required; legacy endpoint; serialized requests and conservative chunking)
- Google Translate (free endpoint + paid API)
- Microsoft Translator (free endpoint + paid API)
- Gemini (API key; v1beta/v1 fallback to avoid “model not found” 404s)
- ChatGPT (API key)
- Custom API (configurable endpoint)

### QA / Debugging

- Unified deterministic test runner: `uv run python tests/run_all.py --fast`
- Real clipboard payload tests (Windows): `uv run python tests/test_real_clipboard_payloads.py --out-root test_results/clipboard_direct`

### Build artifacts

- Firefox XPI: `dist/gpt-latex-ctrl-c-v.xpi`
- Chromium (MV3) bundle: `dist/chromium/` and `dist/gpt-latex-ctrl-c-v-chromium.zip`

