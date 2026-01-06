"""
Real-life clipboard payload verification (Windows-only).

Goal: verify the extension writes OS clipboard formats directly (CF_HTML + CF_UNICODETEXT),
without involving Word/docx post-processing.

Covers the 4 copy options:
- Copy as Office Format (HTML selection)
- Copy as Office Format (Markdown selection)
- Copy as Markdown
- Copy selection HTML (exact selection fragment)

Artifacts: test_results/clipboard_direct/** (dump.json, cfhtml.txt, fragment.html, plain.txt, console.log, poll_log.json)
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
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


class _QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        return


def _write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # Important: preserve exact newline bytes from the clipboard text.
    # On Windows, text-mode newline translation would turn "\r\n" into "\r\r\n",
    # which makes Markdown look like it has extra blank lines.
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(text)


def _write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _wait_until_clipboard(predicate, *, timeout_s: float = 20.0, poll_s: float = 0.2) -> tuple[dict, list[dict]]:
    """
    Deterministic clipboard polling.

    predicate(clipboard_dump) -> bool
    Returns: (final_clipboard_dump, poll_log)
    """
    t0 = time.monotonic()
    polls: list[dict] = []
    last: dict = {}
    while True:
        last = dump_clipboard()
        ok = False
        try:
            ok = bool(predicate(last))
        except Exception:
            ok = False
        polls.append(
            {
                "t_s": round(time.monotonic() - t0, 3),
                "ok": ok,
                "plain_len": len(str(last.get("plain_text", ""))),
                "has_html_format": bool(last.get("has_html_format")),
                "cfhtml_len": int(last.get("cfhtml_length") or 0),
            }
        )
        if ok:
            return last, polls
        if time.monotonic() - t0 >= timeout_s:
            return last, polls
        time.sleep(poll_s)


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


async def _set_extension_config(service_worker, config: dict) -> None:
    await service_worker.evaluate(
        """
        async ({ cfg }) => {
            const chrome = globalThis.chrome;
            const STORAGE_KEY = "gptLatexCtrlCVConfig";
            await new Promise((resolve, reject) => {
                chrome.storage.local.set({ [STORAGE_KEY]: cfg }, () => {
                    const err = chrome.runtime?.lastError;
                    if (err) reject(new Error(err.message || String(err)));
                    else resolve(true);
                });
            });
            return true;
        }
        """,
        {"cfg": config},
    )


@dataclass(frozen=True)
class Case:
    name: str
    selector: str
    message: dict
    expect_html: bool
    expect_plain_contains: list[str]
    expect_fragment_contains: list[str]


async def main() -> int:
    if os.name != "nt":
        raise SystemExit("This test is Windows-only (needs OS clipboard access).")

    ap = argparse.ArgumentParser(description="Real clipboard payload tests (Windows; overwrites clipboard).")
    ap.add_argument("--out-root", default=str(PROJECT_ROOT / "test_results" / "clipboard_direct"))
    ap.add_argument("--debug", action="store_true")
    args = ap.parse_args()

    out_root = Path(args.out_root)
    if out_root.exists():
        shutil.rmtree(out_root)
    out_root.mkdir(parents=True, exist_ok=True)

    # Build Chromium MV3 test bundle (ensures latest sources are copied).
    dist_dir = build_chromium_extension(PROJECT_ROOT / "dist" / "chromium")

    html_path = PROJECT_ROOT / "examples" / "clipboard_direct_test.html"
    if not html_path.exists():
        raise SystemExit(f"Missing example: {html_path}")

    # Serve examples via local HTTP to keep permissions stable.
    httpd: ThreadingHTTPServer | None = None
    http_thread: threading.Thread | None = None
    port_holder: list[int] = []

    def _serve():
        nonlocal httpd
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), _QuietHandler)
        port_holder.append(int(httpd.server_port))
        httpd.serve_forever()

    http_thread = threading.Thread(target=_serve, daemon=True)
    http_thread.start()
    while not port_holder:
        time.sleep(0.01)
    port = port_holder[0]

    rel = html_path.relative_to(PROJECT_ROOT).as_posix()
    url = f"http://127.0.0.1:{port}/{rel}"

    console_lines: list[str] = []

    user_data_dir = Path(tempfile.mkdtemp(prefix="playwright-chromium-ext-"))
    try:
        async with async_playwright() as pw:
            context = await pw.chromium.launch_persistent_context(
                user_data_dir=user_data_dir,
                headless=False,  # extensions require headful
                args=[
                    f"--disable-extensions-except={dist_dir}",
                    f"--load-extension={dist_dir}",
                    "--disable-features=ExtensionManifestV2Disabled",
                    *(
                        []
                        if args.debug
                        else [
                            "--window-position=-32000,-32000",
                            "--window-size=800,600",
                            "--start-minimized",
                        ]
                    ),
                ],
            )

            # Deterministic clipboard precondition: explicitly grant clipboard permissions for the test origin.
            await context.grant_permissions(["clipboard-read", "clipboard-write"], origin=f"http://127.0.0.1:{port}")

            page = context.pages[0] if context.pages else await context.new_page()
            page.on("console", lambda m: console_lines.append(f"{m.type}: {m.text}"))

            sw = None
            sws = getattr(context, "service_workers", None)
            if sws:
                sw = sws[0] if sws else None
            if not sw:
                sw = await context.wait_for_event("serviceworker")

            # Disable translation for deterministic, offline clipboard payload testing.
            await _set_extension_config(
                sw,
                {
                    "translation": {
                        "enabled": False,
                        "service": "pollinations",
                        "targetLanguages": ["en", "id", "ar", "zh-CN", "ru"],
                        "translateFormulas": False,
                        "defaultLanguage": "en",
                    },
                    "keyboard": {"interceptCopy": False},
                    "apiKeys": {
                        "google": "",
                        "microsoft": "",
                        "chatgpt": "",
                        "gemini": "",
                        "pollinations": "",
                        "custom": "",
                    },
                    "customApi": {"endpoint": "", "headers": {}, "method": "POST", "payloadFormat": {}},
                },
            )

            await page.goto(url, wait_until="domcontentloaded")
            await page.wait_for_function(
                "() => document.documentElement?.dataset?.copyOfficeFormatExtensionLoaded === 'true'",
                timeout=15_000,
            )

            cases: list[Case] = [
                Case(
                    name="copy_office_format_html",
                    selector="#sel",
                    message={"type": "COPY_OFFICE_FORMAT", "mode": "html"},
                    expect_html=True,
                    expect_plain_contains=["COF_CLIP_HTML_TOKEN_123456"],
                    expect_fragment_contains=["COF_CLIP_HTML_TOKEN_123456"],
                ),
                Case(
                    name="copy_office_format_markdown",
                    selector="#md",
                    message={"type": "COPY_OFFICE_FORMAT", "mode": "markdown"},
                    expect_html=True,
                    expect_plain_contains=["COF_CLIP_MD_TOKEN_123456"],
                    expect_fragment_contains=["COF_CLIP_MD_TOKEN_123456"],
                ),
                Case(
                    name="copy_as_markdown",
                    selector="#md",
                    message={"type": "COPY_AS_MARKDOWN"},
                    expect_html=False,
                    expect_plain_contains=["COF_CLIP_MD_TOKEN_123456", "- item 1"],
                    expect_fragment_contains=[],
                ),
                Case(
                    name="copy_selection_html",
                    selector="#sel",
                    message={"type": "COPY_AS_HTML"},
                    expect_html=True,
                    expect_plain_contains=["COF_CLIP_HTML_TOKEN_123456", "<strong>"],
                    expect_fragment_contains=["COF_CLIP_HTML_TOKEN_123456", "<strong>"],
                ),
            ]

            for c in cases:
                case_dir = out_root / c.name
                case_dir.mkdir(parents=True, exist_ok=True)
                console_lines.clear()

                selected_text = await _select_selector(page, c.selector)
                if not selected_text:
                    raise RuntimeError(f"Selection empty for selector {c.selector} (case={c.name})")

                # Action: trigger the extension copy path deterministically (no native copy triggers).
                resp = await _chromium_send_to_active_tab(sw, c.message)
                _write_json(case_dir / "send_message_response.json", resp or {})

                # Postcondition: clipboard contains expected markers.
                def _pred(dump: dict) -> bool:
                    plain = str(dump.get("plain_text", ""))
                    frag = str(dump.get("fragment", ""))
                    if any(tok not in plain for tok in c.expect_plain_contains):
                        return False
                    if c.expect_html:
                        if not dump.get("has_html_format"):
                            return False
                        if any(tok not in frag for tok in c.expect_fragment_contains):
                            return False
                    return True

                clip, poll_log = _wait_until_clipboard(_pred, timeout_s=20.0, poll_s=0.2)
                _write_json(case_dir / "clipboard_poll_log.json", poll_log)
                _write_json(case_dir / "clipboard_dump.json", clip)
                _write_text(case_dir / "clipboard_plain.txt", str(clip.get("plain_text", "")))
                _write_text(case_dir / "clipboard_fragment.html", str(clip.get("fragment", "")))
                _write_text(case_dir / "clipboard_cfhtml.txt", str(clip.get("cfhtml", "")))
                _write_text(case_dir / "console.log", "\n".join(console_lines) + ("\n" if console_lines else ""))

                # Assertions with deterministic errors.
                if c.expect_html:
                    v = (clip.get("cfhtml_validation") or {}).get("ok")
                    if not v:
                        raise AssertionError(f"CF_HTML validation failed for case {c.name}")
                for tok in c.expect_plain_contains:
                    if tok not in str(clip.get("plain_text", "")):
                        raise AssertionError(f"plain_text missing token {tok!r} (case={c.name})")
                for tok in c.expect_fragment_contains:
                    if tok not in str(clip.get("fragment", "")):
                        raise AssertionError(f"fragment missing token {tok!r} (case={c.name})")

            await context.close()
    finally:
        try:
            if httpd:
                httpd.shutdown()
        except Exception:
            pass
        try:
            shutil.rmtree(user_data_dir, ignore_errors=True)
        except Exception:
            pass

    print(f"OK: wrote artifacts under {out_root}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
