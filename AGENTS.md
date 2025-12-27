# Repository Guidelines

## Project Structure & Module Organization
- Extension sources live in `extension/` (`content-script.js`, `background.js`, `constants.js`, `manifest.json` for Firefox MV2, `manifest.chromium.json` for the Chromium MV3 test build).
- Real-world fixtures: `examples/` (Gemini/ChatGPT HTML captures used for deterministic testing).
- Automation: `tests/`; helper scripts: `tools/`; Rust WASM converter: `rust/`.

## Build, Test, and Development Commands (uv)
- `uv sync` - sync environment.
- `tests/run_tests.bat` / `tests/run_tests.sh` - one command: builds Rust WASM and runs the Playwright suite (no persistent test artifacts by default).
- `uv run python tests/test_automated.py --browser chromium` - Playwright-only suite (DOM-proved readiness; no "network idle").
- `uv run python tests/test_word_examples.py` - Word paste verification for `examples/` (writes `.docx` + `document.xml` into `artifacts/word_examples/`).
- `uv run python tests/test_comprehensive.py --browser chromium --phase critical` - deeper coverage by phase.
- `uv run python tools/bidi_probe.py --url <url>` - Firefox BiDi DOM probe + artifacts.
- `uv run playwright install chromium` - install Playwright browser used by tooling/tests.

## Coding Style & Naming Conventions
- JavaScript: 2-space indent, prefer `const`/`let`, keep `DEBUG = false` by default.
- Tests: Python follows PEP 8; HTML examples live in `examples/*.html`, runners in `tests/*.py`.

## Deterministic Automation Rules (Hard)
- Target outcome: deterministic, debuggable automation.
- Success criterion (exact): every automated step MUST have precondition -> action -> postcondition verified from artifacts (HTML, console log, screenshot, diff).
- Tooling policy (complexity ladder; do not skip): L0 stdlib only -> L1 small primitives (`requests`/`curl`, `lxml`) -> L2 explicit JS probes in headful Chromium -> L3 Playwright/Selenium only if L0-L2 cannot satisfy requirements.
- Gate to move up Li -> Li+1 (all required): `Need_JS = true` (required content absent from server-rendered HTML), postcondition is DOM-verifiable (not “framework event says loaded”), versions pinned (`browser_version`, `driver_version`, `lib_version`), and a lower-level fallback exists (even partial) to isolate failures.
- Anti-flakiness (ban unknown waits): allowed waiting is only `wait_until(P, T_deadline, dt_poll)` where `P` is DOM-verifiable and logged (predicate + polls + final DOM snapshot). Banned: "network idle" without independent verification, `sleep()` as primary sync (sleep only as backoff inside `wait_until`), and internal framework events as proof of readiness.
- Evidence bundle (non-negotiable deliverable): produce `artifacts/` containing `page.html`, `target_subtree.html`, `console.log`, `screenshot.png`, `extracted.json`, `diff.txt` (+ `network.har` if available), plus a predicate truth table and a minimal reproduction command.
- Keep `artifacts/` for ad-hoc/manual probes (tests do not write persistent artifacts unless explicitly requested).
- Dependency hygiene (exact): `D_max = 3` third-party libraries unless explicitly authorized; pin exact versions (`==x.y.z`); no mid-task framework switching without a failure report (repro steps + artifacts + suspected root cause + one minimal next change).

## Commit & Pull Request Guidelines
- History is minimal ("Initial Commit"); keep commits small and imperative (e.g., "Fix DOM-ready probe for tests").
- PRs: include purpose, commands run, and artifacts/screenshots when behavior changes.
