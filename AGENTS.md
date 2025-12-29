# Repository Guidelines

## Project Structure & Module Organization

- Extension sources: `extension/` (Firefox MV2; Chromium test build: `dist/chromium/`).
- Tests are driven only by `examples/*.html` (no HTML fixtures under `tests/`).
- Runners/helpers: `tests/`, `lib/tools/`; Rust/WASM: `lib/rust/`; outputs: `test_results/` and `artifacts/` (debug only).
- Conversion core: `lib/rust/tex_to_mathml_wasm/` (TeX->MathML + HTML<->Markdown + HTML->Office normalization), built into `extension/wasm/tex_to_mathml.wasm`.

## Build, Test, and Development Commands (uv)

- `uv sync`
- `uv run playwright install chromium`
- `tests/run_tests.bat` / `tests/run_tests.sh`
- `uv run python tests/test_generate_docx_examples.py` (writes `test_results/docx/*.docx`)
- Windows (real clipboard -> docx artifacts): `uv run python tests/test_real_clipboard_docx.py --out-root test_results/real_clipboard`
- Windows (copy-as-markdown -> clipboard text artifacts): `uv run python tests/test_real_clipboard_markdown.py --out-root test_results/real_clipboard_markdown`
- Optional (Windows): `uv run python tests/test_word_examples.py`
- Rebuild WASM after Rust changes: `uv run python lib/tools/build_rust_wasm.py`
- Enforce JS size budget: `uv run python lib/tools/check_js_size.py` (hard: `extension/content-script.js` <= 20KB)
- Clean outputs before sharing/debugging: `uv run python lib/tools/cleanup_test_results.py`
- Validate a captured Windows CF_HTML payload: `uv run python lib/tools/validate_cf_html.py --in test.bin`

## Standard Procedure (Required)

- After code changes: run `uv run python tests/test_automated.py` and include the pass/fail summary in PR notes.
- If Rust changed: run `uv run python lib/tools/build_rust_wasm.py` (WASM must be up to date).
- If JS changed: run `uv run python lib/tools/check_js_size.py` (content script must stay <= 20KB).
- After test runs: run `uv run python lib/tools/cleanup_test_results.py` so `test_results/` only contains the most recent outputs.
- If debugging Word truncation/CF_HTML: run `uv run python tests/test_real_clipboard_docx.py --out-root test_results/real_clipboard` and inspect `cfhtml_validation.json` per case.

## Coding Style & Naming Conventions

- JavaScript: 2-space indent, prefer `const`/`let`, keep `DEBUG = false` by default.
- Tests: Python follows PEP 8; examples in `examples/*.html`, runners in `tests/*.py`.
- Rust/WASM: keep exports stable + deterministic; if `api_version()` changes, update `extension/content-script.js` to match and rebuild via `uv run python lib/tools/build_rust_wasm.py`.
- HTML parsing for sanitizing uses Servo's `markup5ever_rcdom` (via `html5ever`); avoid custom TreeSink implementations.

## Deterministic Automation Rules (Hard)

### 1) Target Outcome (What These Rules Enforce)

- **Primary objective:** minimize wasted time by enforcing deterministic, observable, debuggable automation paths.
- **Operating principle:** prefer raw, inspectable mechanisms (HTTP fetch + DOM parse + explicit assertions) over black-box orchestration (implicit "loaded" events, "network idle", hidden readiness flags).
- **Success criterion (Exact):** every automated step must have an explicit **precondition**, **action**, and **postcondition** that can be verified from artifacts (HTML snapshot, console log, screenshot, diff).

**Clipboard determinism (Exact):** never use a browser's native "copy selection" behavior as a source of truth. Concretely, do **not** rely on the browser to generate clipboard HTML from the active selection (or any implicit copy pipeline). Always extract selection HTML deterministically via `Range.cloneContents()` → `container.innerHTML` and generate the clipboard payload explicitly, with verifiable artifacts/validation.

**ABSOLUTE (Exact): NEVER use browser-native copy/paste functions** as part of the extension pipeline (including any implicit/native "copy selection" behavior). Treat them as non-deterministic and non-debuggable.
**Banned (Exact):** using the browser's native copy pipeline as a *source of truth* (i.e., "copy selection" and accept whatever HTML the browser generates).

**Banned (Exact):** never call `document.execCommand('copy')` (or any equivalent "native copy" trigger) anywhere in the extension. Clipboard writes must use explicit, inspectable APIs (`navigator.clipboard.write([ClipboardItem])` / `navigator.clipboard.writeText`) and must fail fast with a debuggable error if unavailable.

**No silent failures (Exact):** silent falling back (empty `catch {}` / ignored rejections) is not allowed. Every failure must either (a) throw, or (b) record a deterministic, inspectable diagnostic (DOM dataset key, saved artifact, or persisted log) that explains what failed and why.

### 2) Tooling Policy: Strict "Complexity Ladder"

**Do not skip levels without written justification.**

- **L0 - Standard library only:** `urllib`/`http`, `html.parser`, `json`, `re`, `sqlite`, `subprocess`.
- **L1 - Small stable primitives:** `requests` (or `curl`), `lxml` (or built-in parser).
- **L2 - DOM emulation / light JS evaluation:** headful Chromium/Firefox, explicit JS probes, data collected via visible DOM/state.
- **L3 - Full automation frameworks:** Playwright/Selenium only if L0-L2 cannot satisfy requirements.

**Gate to move up a level (Exact):** Li -> Li+1 only if all are true:

- **Necessity:** `Need_JS = true` because required content is absent from server-rendered HTML.
- **Observability:** postcondition is verified by reading DOM/state artifacts (not "event says loaded").
- **Pinning:** all runtime versions are pinned (`browser_version`, `driver_version`, `lib_version`).
- **Rollback:** a lower-level fallback exists (even partial) to isolate failures.

### 3) Anti-Flakiness Rules (Ban "Unknown Waits")

**Waiting is a function, not a hope.**

- Define: `T_deadline` (default 20s), `dt_poll` (default 200ms), `P()` = DOM-verifiable predicate.
- **Rule (Exact):** waiting is only `wait_until(P, T_deadline, dt_poll)` and must log: predicate definition, each poll result, and a final state snapshot.
- **Banned (Exact):**
  - "wait for network idle" without independent verification
  - `sleep()` as the primary synchronization mechanism (sleep only allowed as backoff _inside_ `wait_until`)
  - relying on internal framework events as proof of readiness

**Postcondition must be inspectable (Exact):** every step ends with at least one of:

- HTML dump (outerHTML of target subtree), screenshot (headful), console log capture,
- DOM selector assertions + extracted text values, or a diff against an expected DOM fragment.

### 4) Browser/DOM Strategy (Aligned to Determinism)

- **Default path (SSR/static):** `GET(url)` -> parse DOM -> extract invariants -> diff(actual, expected) -> fail with an artifact bundle.
- **If JS is required:** use explicit JS probes that return "real status" (presence/visibility, computed styles, status text, DOM attributes actually used by UI).
- **Extensions:** verify by visible evidence (injected DOM marker/options status + screenshot + DOM snippet); never trust hidden flags alone.

### 5) Dependency Hygiene (Stop Framework Churn)

- **Dependency budget (Exact):** `D_max = 3` third-party libraries unless the user explicitly authorizes more.
- **Pin everything (Exact):** `lib==x.y.z`, browser channel/version, driver version, OS target.
- **No mid-task framework switching (Exact):** if approach A fails, first produce a failure report (repro steps + artifacts + suspected root cause + minimal next change).

### 6) Debuggability: Evidence Bundle (Non-Negotiable)

For any non-trivial automation, output must include an `artifacts/` plan (even if conceptual):
`page.html`, `target_subtree.html`, `console.log`, `screenshot.png`, `network.har` (if available), `extracted.json`, `diff.txt`.
Also include a "truth table" of predicates `P1..Pk` with pass/fail + extracted values, and a minimal reproduction command line.

### 7) Ready-To-Paste Ruleset (System-Prompt Style)

```text
Prefer minimal mechanisms: Use standard library first (L0), then small stable libs (L1). Use full browser automation (L3) only with written justification and pinned versions.

No black-box synchronization: Do not rely on implicit events ("network idle", "loaded", framework waits). All waiting must be wait_until(predicate) where predicate is DOM-verifiable and logged.

Observable postconditions: Every step must end with DOM/text assertions and saved artifacts (HTML snippet, console log, screenshot for headful).

No framework thrashing: Do not switch frameworks/tools mid-task without a failure report and a single minimal next change.

Pin versions: Pin all library and runtime versions; do not use "latest" by default.

Extension verification: Prove extension status via visible UI/DOM effects + artifacts; never trust hidden flags alone.

Fail fast with evidence: On failure, provide reproduction steps, artifacts list, and the narrowest plausible root cause.
```

### 8) Rationale (Why This Works)

- Determinism + explicit predicates reduce flake; artifacts turn timeouts into a traceable state machine; the ladder/budget prevents runaway toolchain churn.

## Chat / Markdown Formatting (Hard)

- Always use fenced code blocks for multi-line code with a language tag.
- Fence must be unindented (column 1), on its own lines, with a blank line before/after; never line-wrap code.
- If the snippet contains ```then use`~~~` fences.
- Use inline backticks for paths/identifiers; never paste raw HTML/JS/JSON without a fence.

## Extension Features (Current)

- Copy modes:
  - Office HTML: "Copy as Office Format" (default)
  - Office from Markdown: "Copy as Office Format (Markdown selection)"
  - Markdown export: "Copy as Markdown"
- Clipboard HTML is provided to the browser as a fragment `text/html` payload; the browser will wrap it into OS-native formats (e.g., Windows CF_HTML) when writing to the clipboard.
- TeX->MathML is performed via Rust/WASM in the content script (no external renderer fallback).
- Rust/WASM owns the deterministic "transition tables" (HTML->Office, HTML->Markdown, Markdown->HTML); JS should stay focused on selection/extraction + clipboard write + MathML->OMML XSLT.

## Commit & Pull Request Guidelines

- Keep commits small and imperative; PRs include purpose + commands run (+ artifacts/screenshots if behavior changes).
