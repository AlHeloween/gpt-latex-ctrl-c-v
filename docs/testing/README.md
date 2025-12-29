# Testing

## Inputs (Hard Rule)

- All tests consume only `examples/*.html` as inputs.

## Commands (uv)

- End-to-end extension test (Playwright): `uv run python tests/test_automated.py`
- Convenience runner:
  - Windows: `tests/run_tests.bat`
  - Linux/Mac: `tests/run_tests.sh`
- Generate deterministic `.docx` outputs from `examples/*.html`: `uv run python tests/test_generate_docx_examples.py`
- Windows only (real clipboard -> Word paste -> `.docx`): `uv run python tests/test_real_clipboard_docx.py --out-root test_results/real_clipboard`

## Where Outputs Go

- Generated documents: `test_results/docx/`
- Real clipboard runs: `test_results/real_clipboard/`
