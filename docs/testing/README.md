# Testing

## Inputs (Hard Rule)

- All tests consume only `examples/*.html` as inputs.

## Commands (uv)

- End-to-end extension test (Playwright): `uv run python tests/test_automated.py`
- Unified runner (recommended): `uv run python tests/run_all.py --fast`
- Convenience runner:
  - Windows: `tests/run_tests.bat`
  - Linux/Mac: `tests/run_tests.sh`
- Generate deterministic `.docx` outputs from `examples/*.html`: `uv run python tests/test_generate_docx_examples.py`
- Windows only (real clipboard -> Word paste -> `.docx`): `uv run python tests/test_real_clipboard_docx.py --out-root test_results/real_clipboard`
  - Debug a single case: `uv run python tests/test_real_clipboard_docx.py --out-root test_results/real_clipboard --only test_large_selection`
- Copy selection HTML exactly (no Word wrappers): use the extension menu "Copy selection HTML" (writes the raw selection fragment as `text/html` to clipboard).

## Where Outputs Go

- Generated documents: `test_results/docx/`
- Real clipboard runs: `test_results/real_clipboard/`
  - Each per-case folder contains `final.docx` (and `docx_from_clipboard.docx`; plus `docx_from_word_paste.docx`/`docx_from_word_paste.document.xml` when Word is available).
