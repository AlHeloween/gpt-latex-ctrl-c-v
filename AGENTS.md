# Repository Guidelines

## Project Structure & Module Organization
- Extension sources: `extension/` (Firefox MV2; Chromium test build: `dist/chromium/`).
- Tests are driven only by `examples/*.html` (no HTML fixtures under `tests/`).
- Runners/helpers: `tests/`, `tools/`; Rust/WASM: `rust/`; outputs: `test_results/` and `artifacts/` (debug only).

## Build, Test, and Development Commands (uv)
- `uv sync`
- `uv run playwright install chromium`
- `tests/run_tests.bat` / `tests/run_tests.sh`
- `uv run python tests/test_generate_docx_examples.py` (writes `test_results/docx/*.docx`)
- Optional (Windows): `uv run python tests/test_word_examples.py`

## Coding Style & Naming Conventions
- JavaScript: 2-space indent, prefer `const`/`let`, keep `DEBUG = false` by default.
- Tests: Python follows PEP 8; examples in `examples/*.html`, runners in `tests/*.py`.

## Deterministic Automation Rules (Hard)
- Enforce deterministic, observable steps: precondition -> action -> postcondition (with inspectable artifacts when needed).
- Complexity ladder: L0 stdlib -> L1 primitives -> L2 explicit JS probes -> L3 Playwright/Selenium only if `Need_JS = true`.
- Ban "unknown waits": only DOM-verifiable predicates + deadline + logged polls (no "network idle"; no sleeps as primary sync).

## Chat / Markdown Formatting (Hard)
- Always use fenced code blocks for multi-line code with a language tag.
- Fence must be unindented (column 1), on its own lines, with a blank line before/after; never line-wrap code.
- If the snippet contains ``` then use `~~~` fences.
- Use inline backticks for paths/identifiers; never paste raw HTML/JS/JSON without a fence.

## Commit & Pull Request Guidelines
- Keep commits small and imperative; PRs include purpose + commands run (+ artifacts/screenshots if behavior changes).
