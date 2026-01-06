"""
Unified test runner for this repo.

Goal: provide a single entry point that can be used on Windows/macOS/Linux, while
keeping deterministic, inspectable behavior.

Usage (recommended):
  uv run python tests/run_all.py --fast
  uv run python tests/run_all.py            # full suite (may overwrite clipboard on Windows)
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class StepResult:
    name: str
    status: str  # PASS | FAIL | SKIP
    rc: int


def _is_windows() -> bool:
    return os.name == "nt"


def _run_step(*, name: str, argv: list[str], cwd: Path, env: dict[str, str] | None = None) -> StepResult:
    print("\n" + "=" * 70)
    print(f"[step] {name}")
    print("=" * 70)
    print(" ".join(argv))
    print("")

    proc = subprocess.run(argv, cwd=str(cwd), env=env, text=True)
    if proc.returncode == 0:
        return StepResult(name=name, status="PASS", rc=0)
    return StepResult(name=name, status="FAIL", rc=proc.returncode)


def _has_chromium_popup(dist_dir: Path) -> bool:
    try:
        return (dist_dir / "popup.html").exists()
    except Exception:
        return False


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Unified test runner (build + tests + optional artifacts).")
    parser.add_argument("--browser", default="chromium", choices=["chromium", "firefox"])
    parser.add_argument("--headless", action="store_true", help="Run headless when supported (Chromium extension tests are typically headful).")
    parser.add_argument("--debug", action="store_true", help="Enable debug logging/UI where supported.")
    parser.add_argument("--skip-translation-unit", action="store_true", help="Skip pure-Python translation/unit tests.")
    parser.add_argument("--with-edge-cases", action="store_true", help="Run Playwright edge-case suite (slower).")
    parser.add_argument("--with-popup", action="store_true", help="Run popup UI suite (may be skipped on Chromium MV3 builds without popup files).")
    parser.add_argument("--fail-fast", action="store_true", help="Stop on first failing test step (after prerequisites).")
    parser.add_argument(
        "--fast",
        action="store_true",
        help="Skip slow/artifact-heavy tests (docx generation, Word paste, real clipboard).",
    )
    parser.add_argument("--include-large", action="store_true", help="Include large examples/*.html in docx/clipboard suites.")
    parser.add_argument("--skip-build-wasm", action="store_true")
    parser.add_argument("--skip-js-size", action="store_true")
    parser.add_argument("--skip-playwright", action="store_true")
    parser.add_argument("--skip-docx", action="store_true")
    parser.add_argument("--skip-word", action="store_true")
    parser.add_argument("--skip-real-clipboard", action="store_true")
    parser.add_argument("--skip-cleanup", action="store_true")
    args = parser.parse_args(argv)

    py = sys.executable
    results: list[StepResult] = []
    first_fail_rc: int | None = None

    def note_result(r: StepResult) -> None:
        nonlocal first_fail_rc
        results.append(r)
        if r.status == "FAIL" and first_fail_rc is None:
            first_fail_rc = r.rc

    if not args.skip_build_wasm:
        note_result(
            _run_step(
                name="Build Rust WASM (tex_to_mathml.wasm)",
                argv=[py, "tools/build_rust_wasm.py"],
                cwd=PROJECT_ROOT,
            )
        )
        if results[-1].status == "FAIL":
            return results[-1].rc

        note_result(
            _run_step(
                name="Translation WASM smoke (no network)",
                argv=["node", "tests/test_translation_wasm_smoke.js"],
                cwd=PROJECT_ROOT,
            )
        )
        if results[-1].status == "FAIL" and args.fail_fast:
            return results[-1].rc

    if not args.skip_js_size:
        note_result(
            _run_step(
                name="Check JS size budgets",
                argv=[py, "tools/check_js_size.py"],
                cwd=PROJECT_ROOT,
            )
        )
        if results[-1].status == "FAIL":
            return results[-1].rc

    if not args.skip_translation_unit:
        note_result(
            _run_step(
                name="Translation unit tests (no network keys)",
                argv=[py, "tests/run_translation_tests.py"],
                cwd=PROJECT_ROOT,
            )
        )
        if results[-1].status == "FAIL" and args.fail_fast:
            return results[-1].rc

        note_result(
            _run_step(
                name="Node: google-free chunking (mocked, no network)",
                argv=["node", "tests/test_translation_google_free_chunking.js"],
                cwd=PROJECT_ROOT,
            )
        )
        if results[-1].status == "FAIL" and args.fail_fast:
            return results[-1].rc

        note_result(
            _run_step(
                name="Node: paid google chunking (mocked, no network)",
                argv=["node", "tests/test_translation_chunking_paid_google.js"],
                cwd=PROJECT_ROOT,
            )
        )
        if results[-1].status == "FAIL" and args.fail_fast:
            return results[-1].rc

        note_result(
            _run_step(
                name="Node: LLM marker integrity (mocked, no network)",
                argv=["node", "tests/test_translation_integrity_llm_markers.js"],
                cwd=PROJECT_ROOT,
            )
        )
        if results[-1].status == "FAIL" and args.fail_fast:
            return results[-1].rc

        note_result(
            _run_step(
                name="Node: anchor restore independent of order",
                argv=["node", "tests/test_anchor_restore_marker_order.js"],
                cwd=PROJECT_ROOT,
            )
        )
        if results[-1].status == "FAIL" and args.fail_fast:
            return results[-1].rc

        note_result(
            _run_step(
                name="Node: selection multi-range dedupe",
                argv=["node", "tests/test_selection_multirange_dedupe.js"],
                cwd=PROJECT_ROOT,
            )
        )
        if results[-1].status == "FAIL" and args.fail_fast:
            return results[-1].rc

        note_result(
            _run_step(
                name="Node: pollinations is serialized (mocked, no network)",
                argv=["node", "tests/test_translation_pollinations_serial.js"],
                cwd=PROJECT_ROOT,
            )
        )
        if results[-1].status == "FAIL" and args.fail_fast:
            return results[-1].rc

        note_result(
            _run_step(
                name="Node: pollinations smoke (mocked, no network)",
                argv=["node", "tests/test_translation_pollinations_smoke.js"],
                cwd=PROJECT_ROOT,
            )
        )
        if results[-1].status == "FAIL" and args.fail_fast:
            return results[-1].rc

        note_result(
            _run_step(
                name="Node: pollinations invalid JSON smoke (mocked, no network)",
                argv=["node", "tests/test_translation_pollinations_invalid_json_smoke.js"],
                cwd=PROJECT_ROOT,
            )
        )
        if results[-1].status == "FAIL" and args.fail_fast:
            return results[-1].rc

        note_result(
            _run_step(
                name="Node: gemini smoke (mocked, no network)",
                argv=["node", "tests/test_translation_gemini_smoke.js"],
                cwd=PROJECT_ROOT,
            )
        )
        if results[-1].status == "FAIL" and args.fail_fast:
            return results[-1].rc

    if not args.skip_playwright:
        pw_common: list[str] = []
        if args.browser:
            pw_common.extend(["--browser", args.browser])
        if args.headless:
            pw_common.append("--headless")
        if args.debug:
            pw_common.append("--debug")

        note_result(
            _run_step(
                name="Playwright: core copy pipeline",
                argv=[py, "tests/test_automated.py", *pw_common],
                cwd=PROJECT_ROOT,
            )
        )
        if results[-1].status == "FAIL" and args.fail_fast:
            return results[-1].rc

        if args.with_edge_cases:
            note_result(
                _run_step(
                    name="Playwright: edge cases",
                    argv=[py, "tests/test_edge_cases.py", *pw_common],
                    cwd=PROJECT_ROOT,
                )
            )
            if results[-1].status == "FAIL" and args.fail_fast:
                return results[-1].rc

        if args.with_popup:
            # The MV3 test build (dist/chromium) may not include popup UI. If it's missing, skip.
            if args.browser == "chromium":
                dist_dir = PROJECT_ROOT / "dist" / "chromium"
                # Ensure dist exists and is fresh-ish.
                _run_step(
                    name="Build Chromium MV3 test bundle (dist/chromium)",
                    argv=[py, "tools/build_chromium_extension.py"],
                    cwd=PROJECT_ROOT,
                )
                if not _has_chromium_popup(dist_dir):
                    note_result(StepResult(name="Playwright: popup UI", status="SKIP", rc=0))
                else:
                    note_result(
                        _run_step(
                            name="Playwright: popup UI",
                            argv=[py, "tests/test_popup.py", *pw_common],
                            cwd=PROJECT_ROOT,
                        )
                    )
                    if results[-1].status == "FAIL" and args.fail_fast:
                        return results[-1].rc
                # already handled
            else:
                note_result(
                    _run_step(
                        name="Playwright: popup UI",
                        argv=[py, "tests/test_popup.py", *pw_common],
                        cwd=PROJECT_ROOT,
                    )
                )
                if results[-1].status == "FAIL" and args.fail_fast:
                    return results[-1].rc

    if args.fast:
        # Skip artifact-heavy suites unless explicitly requested.
        args.skip_docx = True
        args.skip_word = True
        args.skip_real_clipboard = True

    if not args.skip_docx:
        docx_args = [py, "tests/test_generate_docx_examples.py"]
        if args.include_large:
            docx_args.append("--include-large")
        note_result(_run_step(name="Generate docx from examples (pure Rust tool)", argv=docx_args, cwd=PROJECT_ROOT))
        if results[-1].status == "FAIL" and args.fail_fast:
            return results[-1].rc

    if not args.skip_word:
        # This test self-skips when Word COM is unavailable.
        note_result(_run_step(name="Word paste verification (Windows; skips if Word not installed)", argv=[py, "tests/test_word_examples.py"], cwd=PROJECT_ROOT))
        if results[-1].status == "FAIL" and args.fail_fast:
            return results[-1].rc

    if not args.skip_real_clipboard:
        if not _is_windows():
            note_result(StepResult(name="Real clipboard suites", status="SKIP", rc=0))
        else:
            note_result(_run_step(name="Real clipboard -> payloads (Windows; overwrites clipboard)", argv=[py, "tests/test_real_clipboard_payloads.py"], cwd=PROJECT_ROOT))
            if results[-1].status == "FAIL" and args.fail_fast:
                return results[-1].rc

            clip_args = [py, "tests/test_real_clipboard_docx.py"]
            if args.include_large:
                clip_args.append("--include-large")
            note_result(_run_step(name="Real clipboard -> docx (Windows; overwrites clipboard)", argv=clip_args, cwd=PROJECT_ROOT))
            if results[-1].status == "FAIL" and args.fail_fast:
                return results[-1].rc

            note_result(_run_step(name="Real clipboard -> markdown (Windows; overwrites clipboard)", argv=[py, "tests/test_real_clipboard_markdown.py"], cwd=PROJECT_ROOT))
            if results[-1].status == "FAIL" and args.fail_fast:
                return results[-1].rc

    if not args.skip_cleanup:
        note_result(_run_step(name="Cleanup test_results (keep most recent outputs)", argv=[py, "tools/cleanup_test_results.py"], cwd=PROJECT_ROOT))
        if results[-1].status == "FAIL" and args.fail_fast:
            return results[-1].rc

    print("\n" + "=" * 70)
    print("SUMMARY")
    print("=" * 70)
    for r in results:
        print(f"{r.status:4s}  {r.name}")
    print("=" * 70)

    return 0 if first_fail_rc is None else (first_fail_rc or 1)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
