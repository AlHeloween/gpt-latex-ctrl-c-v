"""
Capture the extension's copy payload via the real extension -> OS clipboard path (Windows).

This avoids any test-only DOM hooks and treats the OS clipboard as the source of truth:
- Select DOM content deterministically (explicit selector)
- Trigger the extension copy via MV3 background service worker -> tabs.sendMessage
- Read Windows clipboard "HTML Format" + CF_UNICODETEXT and persist a JSON payload
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import shutil
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from playwright.async_api import async_playwright


PROJECT_ROOT = Path(__file__).resolve().parents[1]


class _QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args: Any) -> None:  # noqa: D401 - match base signature
        return


async def _dom_prove_ready(page) -> None:
    await page.wait_for_selector("body", timeout=5000, state="attached")
    await page.wait_for_function(
        "() => document.readyState === 'interactive' || document.readyState === 'complete'",
        timeout=5000,
    )
    probe_value = await page.evaluate(
        """
        () => {
            const value = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
            let el = document.getElementById("__pw_dom_probe");
            if (!el) {
                el = document.createElement("div");
                el.id = "__pw_dom_probe";
                el.style.display = "none";
                document.documentElement.appendChild(el);
            }
            el.textContent = value;
            return value;
        }
        """
    )
    await page.wait_for_function(
        "(expected) => document.getElementById('__pw_dom_probe')?.textContent === expected",
        arg=probe_value,
        timeout=5000,
    )


async def _wait_extension_marker(page) -> None:
    await page.wait_for_function(
        """
        () => document.documentElement?.dataset?.copyOfficeFormatExtensionLoaded === "true"
        """,
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


async def _select_selector(page, selector: str | None) -> str:
    if not selector:
        selector = "body"
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


async def run(
    *,
    rel_path: str,
    selector: str | None,
    out_json: Path,
    headless: bool,
    timeout_ms: int,
    show_ui: bool = False,
) -> None:
    if os.name != "nt":
        raise RuntimeError("capture_extension_payload is Windows-only (needs OS clipboard access)")

    from tools.win_clipboard_dump import dump_clipboard  # type: ignore

    # Always rebuild the Chromium extension bundle so we never test a stale dist/.
    chromium_dir = PROJECT_ROOT / "dist" / "chromium"
    from tools.build_chromium_extension import build  # type: ignore

    build(chromium_dir)

    handler = lambda *a, **kw: _QuietHandler(*a, directory=str(PROJECT_ROOT), **kw)  # noqa: E731
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    port = httpd.server_address[1]
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()

    rel = rel_path.lstrip("/").replace("\\", "/")
    url = f"http://127.0.0.1:{port}/{rel}"

    user_data_dir = PROJECT_ROOT / "tmp-user-data" / f"capture-{time.time_ns()}"

    async with async_playwright() as p:
        # Chromium extensions generally require headful mode. When running headful in CI/dev,
        # keep the window off-screen by default so it doesn't disrupt the user.
        extra_args: list[str] = []
        if (not headless) and (not show_ui):
            extra_args.extend(
                [
                    "--window-position=-32000,-32000",
                    "--window-size=800,600",
                    "--start-minimized",
                ]
            )

        context = await p.chromium.launch_persistent_context(
            user_data_dir=str(user_data_dir),
            headless=headless,
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
            await context.grant_permissions(
                ["clipboard-read", "clipboard-write"],
                origin=f"http://127.0.0.1:{port}",
            )

            service_worker = None
            sws = getattr(context, "service_workers", None)
            if sws:
                service_worker = sws[0] if sws else None
            if not service_worker:
                service_worker = await context.wait_for_event("serviceworker")

            page = context.pages[0] if context.pages else await context.new_page()
            # XSS fixtures intentionally trigger dialogs; dismiss deterministically.
            try:
                def _swallow_task_result(t):  # noqa: ANN001 - callback signature
                    try:
                        _ = t.exception()
                    except Exception:
                        pass

                def _on_dialog(d):  # noqa: ANN001 - Playwright dialog object
                    try:
                        task = asyncio.create_task(d.dismiss())
                        task.add_done_callback(_swallow_task_result)
                    except Exception:
                        pass

                page.on("dialog", _on_dialog)
            except Exception:
                pass
            await page.goto(url, wait_until="domcontentloaded")
            await _dom_prove_ready(page)
            await _wait_extension_marker(page)

            selected_text = await _select_selector(page, selector)
            token = (selected_text.strip().splitlines() or [""])[0][:64]
            before_sha = dump_clipboard().get("cfhtml_bytes_sha256") or ""

            resp = await _chromium_send_to_active_tab(
                service_worker,
                {"type": "COPY_OFFICE_FORMAT", "mode": "html"},
            )
            if not resp or not resp.get("ok", False):
                err = resp.get("error") if isinstance(resp, dict) else None
                last_err = await page.evaluate(
                    "() => document.documentElement?.dataset?.copyOfficeFormatLastCopyError || ''"
                )
                raise RuntimeError(f"COPY_OFFICE_FORMAT failed: {err or last_err or 'unknown error'}")

            # Wait until OS clipboard reflects this selection.
            t0 = time.monotonic()
            last = None
            while True:
                d = dump_clipboard()
                last = d
                sha = d.get("cfhtml_bytes_sha256") or ""
                plain = d.get("plain_text") or ""
                if sha and sha != before_sha and token and token in plain:
                    break
                if time.monotonic() - t0 >= max(2.0, float(timeout_ms) / 1000.0):
                    break
                time.sleep(0.2)

            if not last:
                raise RuntimeError("Failed to read clipboard")
            if token and token not in str(last.get("plain_text", "")):
                raise RuntimeError("Clipboard did not update with expected selection token")

            payload = {
                "lastClipboard": {
                    "wrappedHtml": last.get("fragment") or "",
                    "plainText": last.get("plain_text") or "",
                    "cfhtml": last.get("cfhtml") or "",
                    "sourceUrl": last.get("source_url") or "",
                },
            }
            out_json.parent.mkdir(parents=True, exist_ok=True)
            out_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
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


def main() -> int:
    parser = argparse.ArgumentParser(description="Capture extension copy payload via real clipboard (Windows).")
    parser.add_argument(
        "--path",
        default="",
        help="Repo-relative HTML path (e.g., examples/selection_example_static.html or examples/gemini-conversation-test.html).",
    )
    parser.add_argument("--test-html", default="gemini-conversation-test.html", help="(Deprecated) HTML fixture filename in tests/.")
    parser.add_argument("--selector", default="message-content:first-of-type", help="CSS selector to select/copy.")
    parser.add_argument("--out", default=str(PROJECT_ROOT / "artifacts" / "extension_payload.json"))
    parser.add_argument("--headless", action="store_true", help="Run headless (Chromium extensions usually require headful).")
    parser.add_argument("--show-ui", action="store_true", help="Show the Chromium window (default keeps it off-screen).")
    parser.add_argument("--timeout-ms", type=int, default=30000, help="Timeout waiting for copy completion.")
    args = parser.parse_args()

    # Chromium extensions generally require headful mode; keep behavior explicit.
    headless = bool(args.headless)
    if headless:
        print("WARNING: Chromium extension tests often require headful mode; retry without --headless if marker missing.")

    asyncio.run(
        run(
            rel_path=args.path if args.path else f"tests/{args.test_html}",
            selector=args.selector if args.selector else None,
            out_json=Path(args.out),
            headless=headless,
            timeout_ms=int(args.timeout_ms),
            show_ui=bool(args.show_ui),
        )
    )
    print(f"OK: wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
