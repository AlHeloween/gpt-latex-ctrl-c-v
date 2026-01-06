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
import time
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

def _write_text_exact(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # Preserve exact newline bytes (clipboard text often contains "\r\n").
    # On Windows, default newline translation would turn "\r\n" into "\r\r\n".
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(text)


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

async def _chromium_send_to_active_tab(service_worker, message: dict) -> dict | None:
    return await service_worker.evaluate(
        """
        async ({ message }) => {
            const chrome = globalThis.chrome;
            if (!chrome?.tabs) throw new Error("chrome.tabs unavailable");
            function call(fn, ...args) {
                return new Promise((resolve, reject) => {
                    fn(...args, (result) => {
                        const err = chrome.runtime?.lastError;
                        if (err) reject(new Error(err.message || String(err)));
                        else resolve(result);
                    });
                });
            }
            const tabs = await call(chrome.tabs.query, { active: true, currentWindow: true });
            const tabId = tabs && tabs[0] ? tabs[0].id : null;
            if (!tabId) throw new Error("no active tab");
            const resp = await call(chrome.tabs.sendMessage, tabId, message);
            return resp || null;
        }
        """,
        {"message": message},
    )


async def _select_selector(page, selector: str) -> str:
    return await page.evaluate(
        """
        ({ selector }) => {
            const el = document.querySelector(selector);
            if (!el) return "";
            const r = document.createRange();
            r.selectNodeContents(el);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(r);
            return sel.toString() || "";
        }
        """,
        {"selector": selector},
    )


def _wait_until_clipboard_contains(marker: str, timeout_s: float = 20.0, poll_s: float = 0.2) -> tuple[dict, list[dict]]:
    """
    Deterministic clipboard polling: wait until CF_UNICODETEXT contains `marker`.

    Returns: (final_clipboard_dump, poll_log)
    """
    t0 = time.monotonic()
    polls: list[dict] = []
    last: dict = {}
    while True:
        last = dump_clipboard()
        plain = str(last.get("plain_text", ""))
        ok = marker in plain
        polls.append(
            {
                "t_s": round(time.monotonic() - t0, 3),
                "ok": ok,
                "plain_len": len(plain),
            }
        )
        if ok:
            return last, polls
        if time.monotonic() - t0 >= timeout_s:
            return last, polls
        time.sleep(poll_s)

def _pick_visible_token(text: str) -> str:
    s = str(text or "")
    s = re.sub(r"<[^>]+>", " ", s)
    s = re.sub(r"&[A-Za-z0-9#]+;", " ", s)
    for tok in re.split(r"\s+", s):
        t = tok.strip("()[]{}<>.,;:!?'\"")
        if len(t) < 6:
            continue
        if any(ch in t for ch in ["<", ">", "=", "\"", "'", "$", "\\"]):
            continue
        if re.search(r"[A-Za-z]", t):
            return t
    return ""


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
            # Deterministic clipboard precondition: explicitly grant clipboard permissions for the test origin.
            await context.grant_permissions(
                ["clipboard-read", "clipboard-write"],
                origin=f"http://127.0.0.1:{port}",
            )
            page = context.pages[0] if context.pages else await context.new_page()
            service_worker = None
            sws = getattr(context, "service_workers", None)
            if sws:
                service_worker = sws[0] if sws else None
            if not service_worker:
                service_worker = await context.wait_for_event("serviceworker")

            for case in cases:
                out_dir = out_root / case.name
                out_dir.mkdir(parents=True, exist_ok=True)

                url = f"http://127.0.0.1:{port}/{case.rel_path}"

                try:
                    await page.goto(url, wait_until="domcontentloaded")
                    await _dom_prove_ready(page)
                    await _wait_extension_marker(page)

                    selected_text = await _select_selector(page, case.selector)
                    token = _pick_visible_token(selected_text) or (selected_text.strip().splitlines() or [""])[0][:64]

                    resp = await _chromium_send_to_active_tab(service_worker, {"type": "COPY_AS_MARKDOWN"})
                    if not resp or not resp.get("ok", False):
                        err = resp.get("error") if isinstance(resp, dict) else None
                        last_err = await page.evaluate(
                            "() => document.documentElement?.dataset?.copyOfficeFormatLastCopyError || ''"
                        )
                        raise RuntimeError(f"COPY_AS_MARKDOWN failed: {err or last_err or 'unknown error'}")

                    clip, poll_log = _wait_until_clipboard_contains(token, timeout_s=20.0, poll_s=0.2)
                    _write_json(out_dir / "clipboard_dump.json", clip)
                    _write_json(out_dir / "clipboard_poll_log.json", poll_log)
                    _write_text_exact(out_dir / "clipboard_plain.txt", str(clip.get("plain_text", "")))

                    plain = str(clip.get("plain_text", ""))
                    ok = token in plain and len(plain.strip()) > len(token)
                    if not ok:
                        summary["ok"] = False
                    summary["cases"][case.name] = {
                        "ok": ok,
                        "token": token,
                        "url": url,
                        "plain_len": len(plain),
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
