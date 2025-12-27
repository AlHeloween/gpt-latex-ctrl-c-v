"""
Generate .docx files from examples/*.html as deterministic test results.

Rules:
- Inputs are discovered by scanning examples/*.html (no fixtures in tests/).
- For each example, we capture the extension-produced wrapped HTML payload.
- We generate a .docx from that wrapped HTML using a pure-Rust converter.
- Outputs are written under test_results/docx/ for inspection and debugging.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile
from dataclasses import dataclass
from pathlib import Path
import re

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import threading

from playwright.async_api import async_playwright

from tools.build_chromium_extension import build as build_chromium_extension  # type: ignore


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
            if f'class="{sel[1:]}' in head or f" {sel[1:]}" in head:
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
    manifest = PROJECT_ROOT / "rust" / "docx_from_html" / "Cargo.toml"
    out_dir = PROJECT_ROOT / "rust" / "docx_from_html" / "target" / "release"
    exe = out_dir / ("docx_from_html.exe" if os.name == "nt" else "docx_from_html")

    def newest_source_mtime() -> float:
        src_dir = PROJECT_ROOT / "rust" / "docx_from_html" / "src"
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
        print(proc.stdout)
        print(proc.stderr, file=sys.stderr)
        raise SystemExit(proc.returncode)
    if not exe.exists():
        raise SystemExit(f"docx tool not found after build: {exe}")
    return exe


def _read_docx_document_xml(docx_path: Path) -> str:
    with zipfile.ZipFile(docx_path, "r") as z:
        return z.read("word/document.xml").decode("utf-8", errors="replace")


def _assert_docx_matches_payload(*, payload_json: Path, docx_path: Path) -> dict[str, bool]:
    payload = json.loads(payload_json.read_text(encoding="utf-8"))
    last = payload.get("lastClipboard") or {}
    wrapped = last.get("wrappedHtml") or ""
    plain = last.get("plainText") or ""

    xml = _read_docx_document_xml(docx_path)

    wl = wrapped.lower()
    has_omml_expected = ("<m:omath" in wl) or ("<m:omathpara" in wl)
    has_omml_actual = ("<m:oMath" in xml) or ("<m:oMathPara" in xml)

    # Text sanity: pick a stable token from the plain text (first long-ish word).
    word = ""
    for tok in re.split(r"\s+", plain):
        if len(tok) >= 6:
            word = tok
            break

    markers = {
        "docx_has_omml": has_omml_actual,
        "payload_expected_omml": has_omml_expected,
        "docx_has_parse_error": "[PARSE ERROR" in xml,
        "docx_contains_tex_annotation": ("application/x-tex" in xml) or ("<annotation" in xml.lower()),
        "docx_contains_plain_token": (word in xml) if word else True,
    }

    if markers["docx_has_parse_error"]:
        raise AssertionError("docx contains [PARSE ERROR marker")
    if markers["docx_contains_tex_annotation"]:
        raise AssertionError("docx contains MathML TeX annotation content (application/x-tex / <annotation>)")
    if has_omml_expected and not has_omml_actual:
        raise AssertionError("payload had OMML but docx lacks OMML elements")
    if not markers["docx_contains_plain_token"]:
        raise AssertionError(f"docx missing expected plain-text token: {word!r}")

    return markers


async def main() -> int:
    parser = argparse.ArgumentParser(description="Generate .docx outputs from examples/*.html")
    parser.add_argument("--examples-dir", default=str(PROJECT_ROOT / "examples"))
    parser.add_argument("--out-dir", default=str(PROJECT_ROOT / "test_results" / "docx"))
    parser.add_argument(
        "--include-large",
        action="store_true",
        help="Include very large HTML files (default skips > 1MB unless a *_static.html exists).",
    )
    args = parser.parse_args()

    examples_dir = Path(args.examples_dir)
    if not examples_dir.exists():
        raise SystemExit(f"Missing examples dir: {examples_dir}")

    cases = _discover_examples(examples_dir)
    if not cases:
        raise SystemExit(f"No examples found in {examples_dir} (expected *.html)")

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
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    summary: dict[str, object] = {"ok": True, "cases": {}}

    # Serve examples via localhost so Chromium content scripts reliably inject.
    class _QuietHandler(SimpleHTTPRequestHandler):
        def log_message(self, *_args) -> None:  # noqa: D401 - match base signature
            return

    handler = lambda *a, **kw: _QuietHandler(*a, directory=str(PROJECT_ROOT), **kw)  # noqa: E731
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    port = httpd.server_address[1]
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()

    # Ensure dist/chromium is up-to-date for capture.
    chromium_dir = PROJECT_ROOT / "dist" / "chromium"
    build_chromium_extension(chromium_dir)

    async with async_playwright() as p:
        user_data_dir = Path(tempfile.mkdtemp(prefix="copy-office-format-docx-user-data-"))
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
                # Keep the window off-screen so it doesn't disrupt the user.
                "--window-position=-32000,-32000",
                "--window-size=800,600",
                "--start-minimized",
            ],
        )
        try:
            page = context.pages[0] if context.pages else await context.new_page()

            async def dom_prove_ready() -> None:
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

            async def wait_extension_marker() -> None:
                await page.wait_for_function(
                    "() => document.documentElement?.dataset?.copyOfficeFormatExtensionLoaded === 'true'",
                    timeout=15_000,
                )

            async def trigger_copy(selector: str | None, timeout_ms: int) -> None:
                await page.evaluate(
                    """
                    ({ selector, timeoutMs }) => new Promise((resolve, reject) => {
                        const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
                        window.dispatchEvent(new CustomEvent("__copyOfficeFormatTestRequest", { detail: { requestId, selector } }));
                    })
                    """,
                    {"selector": selector, "timeoutMs": timeout_ms},
                )

            async def read_payload() -> dict:
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

            for case in cases:
                print(f"[case] {case.name}")
                tmp = Path(tempfile.mkdtemp(prefix=f"copy-office-format-docx-{case.name}-"))
                try:
                    rel = case.rel_path.lstrip("/").replace("\\", "/")
                    url = f"http://127.0.0.1:{port}/{rel}"
                    await page.goto(url, wait_until="domcontentloaded")
                    await dom_prove_ready()
                    await wait_extension_marker()
                    await trigger_copy(case.selector, timeout_ms=60_000)
                    payload = await read_payload()

                    payload_json = tmp / "extension_payload.json"
                    payload_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

                    last = payload.get("lastClipboard") or {}
                    wrapped = last.get("wrappedHtml") or ""
                    if not wrapped:
                        raise AssertionError("missing lastClipboard.wrappedHtml in payload")

                    html_in = tmp / "wrapped.html"
                    html_in.write_text(wrapped, encoding="utf-8")

                    docx_path = out_dir / f"{case.name}.docx"
                    proc = subprocess.run(
                        [str(exe), "--html-file", str(html_in), "--out", str(docx_path), "--title", case.name],
                        cwd=str(PROJECT_ROOT),
                        capture_output=True,
                        text=True,
                    )
                    if proc.returncode != 0:
                        raise AssertionError(f"docx tool failed: {proc.stderr.strip()}")

                    markers = _assert_docx_matches_payload(payload_json=payload_json, docx_path=docx_path)
                    summary["cases"][case.name] = {"ok": True, "docx": str(docx_path), "markers": markers}
                    print(f"OK: wrote {docx_path.name}")
                except Exception as e:
                    summary["ok"] = False
                    summary["cases"][case.name] = {"ok": False, "error": str(e)}
                    print(f"FAIL: {case.name}: {e}", file=sys.stderr)
                finally:
                    shutil.rmtree(tmp, ignore_errors=True)
        finally:
            try:
                await context.close()
            except Exception:
                pass
            shutil.rmtree(user_data_dir, ignore_errors=True)
            try:
                httpd.shutdown()
                httpd.server_close()
            except Exception:
                pass

    _write_json(out_dir / "summary.json", summary)
    return 0 if summary["ok"] else 1


if __name__ == "__main__":
    import asyncio

    raise SystemExit(asyncio.run(main()))
