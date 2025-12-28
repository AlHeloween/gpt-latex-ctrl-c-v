"""
Real-life clipboard verification for "Copy as Markdown".

- Inputs: examples/*.html only (no fixtures in tests/).
- Action: load each example in Chromium with the extension, trigger Markdown copy, then read OS clipboard
  (Windows CF_UNICODETEXT) and persist artifacts.
- Outputs: test_results/real_clipboard_markdown/** for inspection.

Notes:
- Windows-only (reads OS clipboard).
- This overwrites the user's clipboard while running.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import shutil
import tempfile
import threading
from dataclasses import dataclass
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.async_api import async_playwright

from tools.build_chromium_extension import build as build_chromium_extension  # type: ignore
from tools.win_clipboard_dump import dump_clipboard  # type: ignore


PROJECT_ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class ExampleCase:
    name: str
    rel_path: str
    selector: str


_PREFERRED_SELECTORS: list[str] = [
    "#extended-response-markdown-content",
    "#content",
    "main",
    "article",
    ".markdown",
    "body",
]


def _write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _first_match_selector(html_path: Path) -> str:
    try:
        head = html_path.read_text(encoding="utf-8", errors="ignore")[:250_000]
    except Exception:
        return "body"

    if (
        "DOM Source of Selection" in head
        or 'id="viewsource"' in head
        or "viewsource.css" in head
        or "resource://content-accessible/viewsource.css" in head
    ):
        return "body"

    marker = 'name="copy-office-format-selector"'
    i = head.find(marker)
    if i >= 0:
        j = head.find('content="', i)
        if j >= 0:
            j += len('content="')
            k = head.find('"', j)
            if k > j:
                sel = head[j:k].strip()
                if sel:
                    return sel

    m = re.search(r'id="([A-Za-z0-9_-]*content[A-Za-z0-9_-]*)"', head)
    if m:
        return f"#{m.group(1)}"

    for sel in _PREFERRED_SELECTORS:
        if sel.startswith("#"):
            if f'id="{sel[1:]}"' in head:
                return sel
        elif sel.startswith("."):
            cls = sel[1:]
            if re.search(rf'class="[^"]*\\b{re.escape(cls)}\\b', head):
                return sel
        else:
            if f"<{sel}" in head:
                return sel

    return "body"


def _discover_examples(examples_dir: Path) -> list[ExampleCase]:
    cases: list[ExampleCase] = []
    for html_path in sorted(examples_dir.glob("*.html")):
        cases.append(
            ExampleCase(
                name=html_path.stem,
                rel_path=f"examples/{html_path.name}",
                selector=_first_match_selector(html_path),
            )
        )
    return cases


def _is_selection_source_example(html_path: Path) -> bool:
    try:
        head = html_path.read_text(encoding="utf-8", errors="ignore")[:5000]
    except Exception:
        return False
    return (
        "DOM Source of Selection" in head
        or 'id="viewsource"' in head
        or "viewsource.css" in head
        or "resource://content-accessible/viewsource.css" in head
    )


def _selection_source_anchor(case_name: str) -> str:
    # Deterministic, human-readable anchor that should appear in the exported Markdown.
    if case_name == "2025-12-28-Document_Continuity":
        return "Comprehensive Integration of Dual Phasor Architectures"
    return ""


async def _dom_prove_ready(page) -> None:
    await page.wait_for_selector("body", timeout=5000, state="attached")
    await page.wait_for_function(
        "() => document.readyState === 'interactive' || document.readyState === 'complete'",
        timeout=5000,
    )


async def _wait_extension_marker(page) -> None:
    await page.wait_for_function(
        "() => document.documentElement?.dataset?.copyOfficeFormatExtensionLoaded === 'true'",
        timeout=15_000,
    )


async def _trigger_copy_markdown(page, selector: str, timeout_ms: int) -> None:
    await page.evaluate(
        """
        ({ selector, timeoutMs }) => new Promise((resolve, reject) => {
            const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
            const timeout = setTimeout(
              () => reject(new Error('Timed out waiting for __copyOfficeFormatTestResult')),
              timeoutMs || 10000
            );
            function onResult(e) {
                const d = e?.detail;
                if (!d || d.requestId !== requestId) return;
                window.removeEventListener('__copyOfficeFormatTestResult', onResult);
                clearTimeout(timeout);
                if (d.ok) resolve(true);
                else reject(new Error(d.error || 'Copy failed'));
            }
            window.addEventListener('__copyOfficeFormatTestResult', onResult);
            window.dispatchEvent(new CustomEvent('__copyOfficeFormatTestRequest', {
              detail: { requestId, selector, mode: 'markdown-export' }
            }));
        })
        """,
        {"selector": selector, "timeoutMs": timeout_ms},
    )


async def main() -> int:
    if os.name != "nt":
        raise SystemExit("This test is Windows-only (needs OS clipboard access).")

    parser = argparse.ArgumentParser(description="Real clipboard Markdown tests (Windows).")
    parser.add_argument("--examples-dir", default=str(PROJECT_ROOT / "examples"))
    parser.add_argument(
        "--out-root", default=str(PROJECT_ROOT / "test_results" / "real_clipboard_markdown")
    )
    parser.add_argument("--timeout-ms", type=int, default=60_000)
    parser.add_argument("--max-cases", type=int, default=0, help="Limit number of cases (0 = all).")
    parser.add_argument("--show-ui", action="store_true", help="Show Chromium window (default off-screen).")
    args = parser.parse_args()

    examples_dir = Path(args.examples_dir)
    out_root = Path(args.out_root)
    out_root.mkdir(parents=True, exist_ok=True)

    cases = _discover_examples(examples_dir)
    if args.max_cases and args.max_cases > 0:
        cases = cases[: int(args.max_cases)]

    # Serve examples via localhost so Chromium content scripts reliably inject.
    class _QuietHandler(SimpleHTTPRequestHandler):
        def log_message(self, *_args) -> None:  # noqa: D401 - match base signature
            return

    handler = lambda *a, **kw: _QuietHandler(*a, directory=str(PROJECT_ROOT), **kw)  # noqa: E731
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    port = httpd.server_address[1]
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()

    chromium_dir = PROJECT_ROOT / "dist" / "chromium"
    build_chromium_extension(chromium_dir)

    summary: dict[str, object] = {"ok": True, "cases": {}}

    async with async_playwright() as p:
        user_data_dir = Path(tempfile.mkdtemp(prefix="copy-office-format-real-md-user-data-"))

        extra_args: list[str] = []
        if not args.show_ui:
            extra_args.extend(["--window-position=-32000,-32000", "--window-size=800,600", "--start-minimized"])

        context = await p.chromium.launch_persistent_context(
            user_data_dir=str(user_data_dir),
            headless=False,
            args=[
                f"--disable-extensions-except={chromium_dir}",
                f"--load-extension={chromium_dir}",
                "--no-first-run",
                "--no-default-browser-check",
                "--disable-popup-blocking",
                "--disable-background-networking",
                "--disable-default-apps",
                "--disable-sync",
                "--disable-translate",
                *extra_args,
            ],
        )
        try:
            page = context.pages[0] if context.pages else await context.new_page()

            for case in cases:
                out_dir = out_root / case.name
                out_dir.mkdir(parents=True, exist_ok=True)

                url = f"http://127.0.0.1:{port}/{case.rel_path}"
                marker = f"COF_MD::{case.name}::{port}"
                is_selection_source = _is_selection_source_example(PROJECT_ROOT / case.rel_path)

                try:
                    await page.goto(url, wait_until="domcontentloaded")
                    await _dom_prove_ready(page)
                    await _wait_extension_marker(page)

                    # Enable real clipboard path for test pages.
                    await page.evaluate(
                        "() => { document.documentElement.dataset.copyOfficeFormatRealClipboard = 'true'; }"
                    )

                    # Inject a visible marker so we can assert the clipboard updated for THIS case.
                    await page.evaluate(
                        """
                        ({ selector, marker }) => {
                          const el = document.querySelector(selector) || document.body;
                          if (!el) throw new Error("No element found for marker injection");
                          const span = document.createElement("span");
                          span.textContent = marker + "\\n";
                          el.insertBefore(span, el.firstChild);
                          return true;
                        }
                        """,
                        {"selector": case.selector, "marker": marker},
                    )

                    await _trigger_copy_markdown(page, case.selector, timeout_ms=int(args.timeout_ms))

                    clip = dump_clipboard()
                    _write_json(out_dir / "clipboard_dump.json", clip)
                    (out_dir / "clipboard_plain.txt").write_text(clip.get("plain_text", ""), encoding="utf-8")

                    plain = str(clip.get("plain_text", ""))
                    if is_selection_source:
                        # Selection-source extraction replaces the HTML, so the injected marker may not survive.
                        anchor = _selection_source_anchor(case.name)
                        ok = len(plain) > 10_000 and (not anchor or anchor in plain)
                    else:
                        ok = marker in plain and len(plain.strip()) > len(marker)
                    if not ok:
                        summary["ok"] = False
                    summary["cases"][case.name] = {
                        "ok": ok,
                        "marker": marker,
                        "url": url,
                        "plain_len": len(plain),
                        "is_selection_source": is_selection_source,
                    }
                except Exception as e:
                    summary["ok"] = False
                    summary["cases"][case.name] = {"ok": False, "error": str(e), "url": url}
        finally:
            try:
                await context.close()
            except Exception:
                pass
            try:
                httpd.shutdown()
                httpd.server_close()
            except Exception:
                pass
            try:
                shutil.rmtree(user_data_dir, ignore_errors=True)
            except Exception:
                pass

    _write_json(out_root / "summary.json", summary)
    return 0 if summary.get("ok") else 2


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
