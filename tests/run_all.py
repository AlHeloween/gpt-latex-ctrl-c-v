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
    parser.add_argument("--with-translation-unit", action="store_true", help="Run pure-Python translation/unit tests.")
    parser.add_argument("--with-edge-cases", action="store_true", help="Run Playwright edge-case suite (slower).")
    parser.add_argument("--with-popup", action="store_true", help="Run popup UI suite (may be skipped on Chromium MV3 builds without popup files).")
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

    if not args.skip_build_wasm:
        results.append(
            _run_step(
                name="Build Rust WASM (tex_to_mathml.wasm)",
                argv=[py, "tools/build_rust_wasm.py"],
                cwd=PROJECT_ROOT,
            )
        )
        if results[-1].status == "FAIL":
            return results[-1].rc

    if not args.skip_js_size:
        results.append(
            _run_step(
                name="Check JS size budgets",
                argv=[py, "tools/check_js_size.py"],
                cwd=PROJECT_ROOT,
            )
        )
        if results[-1].status == "FAIL":
            return results[-1].rc

    if args.with_translation_unit:
        results.append(
            _run_step(
                name="Translation unit tests (no network keys)",
                argv=[py, "tests/run_translation_tests.py"],
                cwd=PROJECT_ROOT,
            )
        )
        if results[-1].status == "FAIL":
            return results[-1].rc

    if not args.skip_playwright:
        pw_common: list[str] = []
        if args.browser:
            pw_common.extend(["--browser", args.browser])
        if args.headless:
            pw_common.append("--headless")
        if args.debug:
            pw_common.append("--debug")

        results.append(
            _run_step(
                name="Playwright: core copy pipeline",
                argv=[py, "tests/test_automated.py", *pw_common],
                cwd=PROJECT_ROOT,
            )
        )
        if results[-1].status == "FAIL":
            return results[-1].rc

        if args.with_edge_cases:
            results.append(
                _run_step(
                    name="Playwright: edge cases",
                    argv=[py, "tests/test_edge_cases.py", *pw_common],
                    cwd=PROJECT_ROOT,
                )
            )
            if results[-1].status == "FAIL":
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
                    results.append(StepResult(name="Playwright: popup UI", status="SKIP", rc=0))
                else:
                    results.append(
                        _run_step(
                            name="Playwright: popup UI",
                            argv=[py, "tests/test_popup.py", *pw_common],
                            cwd=PROJECT_ROOT,
                        )
                    )
                    if results[-1].status == "FAIL":
                        return results[-1].rc
                # already handled
            else:
                results.append(
                    _run_step(
                        name="Playwright: popup UI",
                        argv=[py, "tests/test_popup.py", *pw_common],
                        cwd=PROJECT_ROOT,
                    )
                )
                if results[-1].status == "FAIL":
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
        results.append(_run_step(name="Generate docx from examples (pure Rust tool)", argv=docx_args, cwd=PROJECT_ROOT))
        if results[-1].status == "FAIL":
            return results[-1].rc

    if not args.skip_word:
        # This test self-skips when Word COM is unavailable.
        results.append(_run_step(name="Word paste verification (Windows; skips if Word not installed)", argv=[py, "tests/test_word_examples.py"], cwd=PROJECT_ROOT))
        if results[-1].status == "FAIL":
            return results[-1].rc

    if not args.skip_real_clipboard:
        if not _is_windows():
            results.append(StepResult(name="Real clipboard suites", status="SKIP", rc=0))
        else:
            clip_args = [py, "tests/test_real_clipboard_docx.py"]
            if args.include_large:
                clip_args.append("--include-large")
            results.append(_run_step(name="Real clipboard -> docx (Windows; overwrites clipboard)", argv=clip_args, cwd=PROJECT_ROOT))
            if results[-1].status == "FAIL":
                return results[-1].rc

            results.append(_run_step(name="Real clipboard -> markdown (Windows; overwrites clipboard)", argv=[py, "tests/test_real_clipboard_markdown.py"], cwd=PROJECT_ROOT))
            if results[-1].status == "FAIL":
                return results[-1].rc

    if not args.skip_cleanup:
        results.append(_run_step(name="Cleanup test_results (keep most recent outputs)", argv=[py, "tools/cleanup_test_results.py"], cwd=PROJECT_ROOT))
        if results[-1].status == "FAIL":
            return results[-1].rc

    print("\n" + "=" * 70)
    print("SUMMARY")
    print("=" * 70)
    for r in results:
        print(f"{r.status:4s}  {r.name}")
    print("=" * 70)

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
