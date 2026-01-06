"""
Real-life clipboard verification:

- Inputs: examples/*.html only (no fixtures in tests/).
- Action: load each example in Chromium with the extension, trigger copy, read *OS clipboard* (Windows),
  and generate a .docx from the clipboard HTML using rust/docx_from_html.
- Outputs: test_results/real_clipboard/** (JSON + .docx) for inspection.

Notes:
- Windows-only (reads "HTML Format" clipboard entry).
- This overwrites the user's clipboard while running.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
from dataclasses import dataclass
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import threading

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
    # Preserve exact newline bytes (clipboard CF_HTML + text often contains "\r\n").
    # On Windows, default newline translation would turn "\r\n" into "\r\r\n".
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(text)


def _first_match_selector(html_path: Path) -> str:
    try:
        head = html_path.read_text(encoding="utf-8", errors="ignore")[:250_000]
    except Exception:
        return "body"

    # Firefox "DOM Source of Selection" (view-selection-source) pages: the real content is inside the
    # rendered source view; selectors like ".markdown" may appear only as *text* and are not valid DOM targets.
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
        if html_path.name.endswith(".html") and not html_path.name.endswith("_static.html"):
            static_candidate = html_path.with_name(f"{html_path.stem}_static.html")
            if static_candidate.exists():
                continue
        cases.append(
            ExampleCase(
                name=html_path.stem,
                rel_path=f"examples/{html_path.name}",
                selector=_first_match_selector(html_path),
            )
        )
    return cases


def _build_docx_tool() -> Path:
    manifest = PROJECT_ROOT  / "rust" / "docx_from_html" / "Cargo.toml"
    out_dir = PROJECT_ROOT  / "rust" / "docx_from_html" / "target" / "release"
    exe = out_dir / ("docx_from_html.exe" if os.name == "nt" else "docx_from_html")

    def newest_source_mtime() -> float:
        src_dir = PROJECT_ROOT  / "rust" / "docx_from_html" / "src"
        mtimes = [manifest.stat().st_mtime]
        for p in src_dir.rglob("*.rs"):
            try:
                mtimes.append(p.stat().st_mtime)
            except Exception:
                pass
        return max(mtimes) if mtimes else 0.0

    if exe.exists():
        try:
            if exe.stat().st_mtime >= newest_source_mtime():
                return exe
        except Exception:
            pass

    proc = subprocess.run(
        ["cargo", "build", "--release", "--manifest-path", str(manifest)],
        cwd=str(PROJECT_ROOT),
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stdout + "\n" + proc.stderr)
    if not exe.exists():
        raise RuntimeError(f"docx tool missing after build: {exe}")
    return exe


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


def _wait_clipboard_has(token: str, before_sha: str, timeout_s: float = 15.0, poll_s: float = 0.2) -> dict:
    t0 = time.monotonic()
    last: dict | None = None
    while True:
        d = dump_clipboard()
        last = d
        sha = d.get("cfhtml_bytes_sha256") or ""
        txt = d.get("plain_text") or ""
        if sha and sha != before_sha and token and token in txt:
            return d
        if time.monotonic() - t0 >= timeout_s:
            return last or {}
        time.sleep(poll_s)


def _wrap_fragment_for_docx(fragment: str) -> str:
    frag = fragment or ""
    low = frag.lower()
    if "<html" in low and "<body" in low:
        return frag
    return f"<html><head><meta charset='utf-8'></head><body>{frag}</body></html>"


def _docx_contains(path: Path, needle: str) -> bool:
    import zipfile

    with zipfile.ZipFile(path) as z:
        xml = z.read("word/document.xml").decode("utf-8", errors="replace")
    return needle in xml


async def main() -> int:
    if os.name != "nt":
        raise SystemExit("This test is Windows-only (needs OS clipboard access).")

    parser = argparse.ArgumentParser(description="Real clipboard tests -> generate docx outputs")
    parser.add_argument("--examples-dir", default=str(PROJECT_ROOT / "examples"))
    parser.add_argument("--out-root", default=str(PROJECT_ROOT / "test_results" / "real_clipboard"))
    parser.add_argument("--timeout-ms", type=int, default=60_000)
    parser.add_argument("--include-large", action="store_true")
    parser.add_argument(
        "--only",
        action="append",
        default=[],
        help="Run only these example case names (repeatable).",
    )
    parser.add_argument("--show-ui", action="store_true", help="Show Chromium window (default off-screen).")
    args = parser.parse_args()

    examples_dir = Path(args.examples_dir)
    out_root = Path(args.out_root)
    out_root.mkdir(parents=True, exist_ok=True)
    # Back-compat cleanup: older versions wrote aggregate outputs to out_root/docx and out_root/word_docx.
    # This suite now writes all artifacts per-case, so remove stale aggregate folders to avoid confusion.
    try:
        shutil.rmtree(out_root / "docx", ignore_errors=True)
        shutil.rmtree(out_root / "word_docx", ignore_errors=True)
    except Exception:
        pass

    # Optional: verify that Word can paste the *real clipboard* CF_HTML.
    # This is the closest end-to-end validation of "extension -> clipboard -> Word".
    word_available = True
    word_error: str | None = None
    try:
        from tools.word_paste_probe import (  # type: ignore
            extract_document_xml,
            set_clipboard_cfhtml,
            word_paste_to_docx,
        )
    except Exception as e:
        word_available = False
        word_error = f"import_failed: {e}"

    cases = _discover_examples(examples_dir)
    if args.only:
        only = set(args.only)
        cases = [c for c in cases if c.name in only]
    if not args.include_large:
        filtered: list[ExampleCase] = []
        for c in cases:
            p = PROJECT_ROOT / c.rel_path
            try:
                if p.stat().st_size > 1_000_000:
                    continue
            except Exception:
                pass
            filtered.append(c)
        cases = filtered

    exe = _build_docx_tool()

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

    summary: dict[str, object] = {"ok": True, "cases": {}, "word_available": word_available, "word_error": word_error}

    async with async_playwright() as p:
        user_data_dir = Path(tempfile.mkdtemp(prefix="copy-office-format-real-clipboard-user-data-"))

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
            # This avoids any reliance on native selection-copy behavior.
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
                docx_out = out_dir / "docx_from_clipboard.docx"
                word_docx_out = out_dir / "docx_from_word_paste.docx"

                url = f"http://127.0.0.1:{port}/{case.rel_path}"

                try:
                    await page.goto(url, wait_until="domcontentloaded")
                    await _dom_prove_ready(page)
                    await _wait_extension_marker(page)

                    selected_text = await _select_selector(page, case.selector)
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

                    # Snapshot page-side debug state (precondition/action/postcondition artifacts).
                    page_debug = await page.evaluate(
                        """
                        () => ({
                          url: location.href,
                          lastStage: document.documentElement.dataset.copyOfficeFormatLastStage || null,
                          lastClipboardWriteError: document.documentElement.dataset.copyOfficeFormatLastClipboardWriteError || null,
                          lastBgSendError: document.documentElement.dataset.copyOfficeFormatLastBgSendError || null,
                          lastXsltError: document.documentElement.dataset.copyOfficeFormatLastXsltError || null,
                          wasmPreloadError: document.documentElement.dataset.copyOfficeFormatWasmPreloadError || null,
                          lastCopyError: document.documentElement.dataset.copyOfficeFormatLastCopyError || null,
                          logs: Array.isArray(window.__cofLogs) ? window.__cofLogs.slice(-50) : null,
                        })
                        """
                    )
                    _write_json(out_dir / "page_debug.json", page_debug)

                    # Read OS clipboard and persist artifacts.
                    clip = _wait_clipboard_has(
                        token=token,
                        before_sha=before_sha,
                        timeout_s=float(args.timeout_ms) / 1000.0,
                    )
                    _write_json(out_dir / "clipboard_dump.json", clip)
                    _write_text_exact(out_dir / "clipboard_cfhtml.txt", str(clip.get("cfhtml", "")))
                    _write_text_exact(out_dir / "clipboard_fragment.html", str(clip.get("fragment", "")))
                    _write_text_exact(out_dir / "clipboard_plain.txt", str(clip.get("plain_text", "")))
                    _write_json(out_dir / "cfhtml_validation.json", clip.get("cfhtml_validation", {}))

                    # Deterministic clipboard postcondition: selection token must be present in plain text.
                    validation = {
                        "expected_token": token,
                        "token_found_in_plain": token in str(clip.get("plain_text", "")),
                        "cfhtml_length": clip.get("cfhtml_length", 0),
                        "fragment_length": len(str(clip.get("fragment", ""))),
                    }
                    _write_json(out_dir / "clipboard_validation.json", validation)

                    if not validation["token_found_in_plain"]:
                        raise RuntimeError("Clipboard did not update for this case (expected token missing in plain text)")

                    cf_ok = bool((clip.get("cfhtml_validation") or {}).get("ok"))
                    if not cf_ok:
                        errs = (clip.get("cfhtml_validation") or {}).get("errors") or []
                        raise RuntimeError(f"Invalid CF_HTML offsets/markers: {errs}")

                    html_for_docx = _wrap_fragment_for_docx(str(clip.get("fragment", "")))
                    in_html = out_dir / "clipboard_for_docx.html"
                    in_html.write_text(html_for_docx, encoding="utf-8")

                    proc = subprocess.run(
                        [str(exe), "--html-file", str(in_html), "--out", str(docx_out), "--title", case.name],
                        cwd=str(PROJECT_ROOT),
                        capture_output=True,
                        text=True,
                    )
                    if proc.returncode != 0:
                        raise RuntimeError(proc.stdout + "\n" + proc.stderr)

                    case_docx_from_clipboard = docx_out

                    # Simple validations:
                    # - If clipboard contains OMML markers, docx must contain OMML.
                    frag_low = str(clip.get("fragment", "")).lower()
                    expects_omml = ("mso-element:omath" in frag_low) or ("<m:omath" in frag_low)
                    has_omml = _docx_contains(docx_out, "<m:oMath") or _docx_contains(docx_out, "<m:oMathPara")
                    expects_code = ("<pre" in frag_low) or ("<code" in frag_low)
                    has_code_font = _docx_contains(docx_out, 'w:rFonts w:ascii="Consolas"')

                    ok = True
                    if expects_omml and not has_omml:
                        ok = False
                    if expects_code and not has_code_font:
                        ok = False

                    word_ok = None
                    word_has_token = None
                    word_error_case = None
                    case_docx_from_word = None
                    if word_available:
                        # Use a Word-stable token: Word paste often replaces math/plain-text with OMML, so
                        # we avoid using the raw first-line token when it contains LaTeX delimiters or when
                        # the selection/plain text is actually HTML markup (e.g. view-source captures).
                        word_token = None
                        try:
                            plain_first = (str(clip.get("plain_text", "")) or "").strip().splitlines()[0].strip()
                            if plain_first:
                                if plain_first.lstrip().startswith("<"):
                                    plain_first = ""
                                elif "$" in plain_first:
                                    plain_first = plain_first.split("$", 1)[0].strip()
                                word_token = plain_first[:64].strip() or None

                            if not word_token:
                                frag = str(clip.get("fragment", "")) or ""
                                frag = re.sub(r"<!--.*?-->", " ", frag, flags=re.DOTALL)
                                frag = re.sub(r"<[^>]+>", " ", frag)
                                frag = re.sub(r"\\s+", " ", frag).strip()
                                if frag:
                                    word_token = frag[:64].strip() or None
                        except Exception:
                            word_token = None

                        try:
                            word_attempts = 0
                            while True:
                                word_attempts += 1
                                set_clipboard_cfhtml(
                                    cfhtml=str(clip.get("cfhtml", "")),
                                    plain_text=str(clip.get("plain_text", "")) or " ",
                                    # Word is picky about CF_HTML header offsets; normalize to UTF-8 byte offsets
                                    # (and a stable header shape) to avoid falling back to plain-text paste.
                                    normalize=True,
                                )
                                word_paste_to_docx(out_docx=word_docx_out, visible=False, timeout_s=120.0)

                                xml_path = out_dir / "docx_from_word_paste.document.xml"
                                xml = extract_document_xml(word_docx_out, xml_path)
                                word_ok = ("<m:oMath" in xml) or ("<m:oMathPara" in xml)
                                word_has_token = (word_token in xml) if word_token else None

                                needs_retry = False
                                if word_has_token is False:
                                    needs_retry = True
                                if expects_omml and not word_ok:
                                    needs_retry = True

                                if needs_retry and word_attempts < 2:
                                    # Keep the failed first attempt for inspection before retrying.
                                    try:
                                        shutil.copy2(word_docx_out, out_dir / "docx_from_word_paste_attempt1_failed.docx")
                                        shutil.copy2(xml_path, out_dir / "docx_from_word_paste_attempt1_failed.document.xml")
                                    except Exception:
                                        pass
                                    continue
                                break

                            case_docx_from_word = word_docx_out

                            if word_has_token is False:
                                ok = False
                            if expects_omml and not word_ok:
                                ok = False
                        except Exception as e:
                            word_error_case = str(e)
                            word_ok = None
                            word_has_token = None

                            # If Word itself isn't available, skip Word validation for the rest of the run.
                            # Otherwise, treat as a real failure for this case (Word couldn't paste our clipboard).
                            err_low = word_error_case.lower()
                            if ("new-object" in err_low and "word.application" in err_low) or ("comobject" in err_low):
                                word_available = False
                                summary["word_available"] = False
                                summary["word_error"] = word_error_case
                            else:
                                ok = False

                    if not ok:
                        summary["ok"] = False

                    # Always provide a single "final.docx" in the case directory:
                    # prefer the Word-pasted result only if it appears to be the *correct* paste (token present,
                    # and OMML present when expected). Otherwise, fall back to the docx generated from the
                    # clipboard fragment.
                    final_docx = out_dir / "final.docx"
                    if (
                        case_docx_from_word
                        and case_docx_from_word.exists()
                        and (word_has_token is not False)
                        and (not expects_omml or word_ok)
                    ):
                        shutil.copy2(case_docx_from_word, final_docx)
                    else:
                        shutil.copy2(case_docx_from_clipboard, final_docx)

                    summary["cases"][case.name] = {
                        "ok": ok,
                        "expected_source_url": url,
                        "actual_source_url": clip.get("source_url", ""),
                        "expects_omml": expects_omml,
                        "docx_has_omml": has_omml,
                        "word_paste_has_omml": word_ok,
                        "word_paste_has_token": word_has_token,
                        "word_paste_error": word_error_case,
                        "expects_code": expects_code,
                        "docx_has_code_font": has_code_font,
                        "docx_from_clipboard": str(case_docx_from_clipboard.relative_to(out_root)).replace("\\", "/"),
                        "docx_from_word_paste": str(case_docx_from_word.relative_to(out_root)).replace("\\", "/") if case_docx_from_word else None,
                        "final_docx": str(final_docx.relative_to(out_root)).replace("\\", "/"),
                    }
                except Exception as e:
                    summary["ok"] = False
                    summary["cases"][case.name] = {
                        "ok": False,
                        "expected_source_url": url,
                        "error": str(e),
                    }
                    continue
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
