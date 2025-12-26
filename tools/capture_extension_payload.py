"""
Capture the extension's copy payload deterministically via DOM (no clipboard permissions).

This uses the content-script's test bridge:
- documentElement.dataset.copyOfficeFormatExtensionLoaded === "true"
- textarea#__copyOfficeFormatTestBridge contains JSON with lastClipboard payload
- dispatch __copyOfficeFormatTestRequest { requestId, selector } and await __copyOfficeFormatTestResult
"""

from __future__ import annotations

import argparse
import asyncio
import json
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
        timeout=5000,
    )


async def _trigger_copy(page, selector: str | None) -> None:
    await _trigger_copy_with_timeout(page, selector, timeout_ms=30000)


async def _trigger_copy_with_timeout(page, selector: str | None, timeout_ms: int) -> None:
    await page.evaluate(
        """
        ({ selector, timeoutMs }) => new Promise((resolve, reject) => {
            const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
            window.__copyOfficeFormatTestLastRequestId = requestId;
            const timeout = setTimeout(
              () => reject(new Error("Timed out waiting for __copyOfficeFormatTestResult")),
              timeoutMs || 10000
            );
            function onResult(e) {
                const d = e?.detail;
                if (!d || d.requestId !== requestId) return;
                window.removeEventListener("__copyOfficeFormatTestResult", onResult);
                clearTimeout(timeout);
                if (d.ok) resolve(true);
                else reject(new Error(d.error || "Copy failed"));
            }
            window.addEventListener("__copyOfficeFormatTestResult", onResult);

            // Dispatch only after the listener is attached (avoid race).
            window.dispatchEvent(new CustomEvent("__copyOfficeFormatTestRequest", { detail: { requestId, selector } }));
        })
        """,
        {"selector": selector, "timeoutMs": timeout_ms},
    )


async def _read_payload(page) -> dict[str, Any]:
    raw = await page.evaluate(
        """
        () => {
            const el = document.getElementById("__copyOfficeFormatTestBridge");
            return el ? el.value : null;
        }
        """
    )
    if not raw:
        raise RuntimeError("Test bridge textarea missing or empty")
    data = json.loads(raw)
    if "lastClipboard" not in data:
        raise RuntimeError("Bridge JSON missing lastClipboard")
    return data


async def run(
    *,
    rel_path: str,
    selector: str | None,
    out_json: Path,
    headless: bool,
    timeout_ms: int,
) -> None:
    # Build/ensure Chromium extension output exists.
    chromium_dir = PROJECT_ROOT / "dist" / "chromium"
    if not chromium_dir.exists():
        raise RuntimeError("Missing dist/chromium; run tools/build_chromium_extension.py first.")

    handler = lambda *a, **kw: _QuietHandler(*a, directory=str(PROJECT_ROOT), **kw)  # noqa: E731
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    port = httpd.server_address[1]
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()

    rel = rel_path.lstrip("/").replace("\\", "/")
    url = f"http://127.0.0.1:{port}/{rel}"

    user_data_dir = PROJECT_ROOT / "tmp-user-data" / f"capture-{time.time_ns()}"

    async with async_playwright() as p:
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
            ],
        )
        try:
            page = context.pages[0] if context.pages else await context.new_page()
            await page.goto(url, wait_until="domcontentloaded")
            await _dom_prove_ready(page)
            await _wait_extension_marker(page)
            await _trigger_copy_with_timeout(page, selector, timeout_ms=timeout_ms)
            payload = await _read_payload(page)
            out_json.parent.mkdir(parents=True, exist_ok=True)
            out_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        finally:
            await context.close()
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
    parser = argparse.ArgumentParser(description="Capture extension copy payload via DOM test bridge.")
    parser.add_argument("--path", default="", help="Repo-relative HTML path (e.g., selection_example.html or tests/gemini-conversation-test.html).")
    parser.add_argument("--test-html", default="gemini-conversation-test.html", help="(Deprecated) HTML fixture filename in tests/.")
    parser.add_argument("--selector", default="message-content:first-of-type", help="CSS selector to select/copy.")
    parser.add_argument("--out", default=str(PROJECT_ROOT / "artifacts" / "extension_payload.json"))
    parser.add_argument("--headless", action="store_true", help="Run headless (Chromium extensions usually require headful).")
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
        )
    )
    print(f"OK: wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
