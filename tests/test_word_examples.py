"""
Deterministic Word-paste verification for HTML examples.

Rules:
- Discover inputs by scanning examples/*.html (no hardcoded fixture list).
- For each example: capture the extension payload, paste into Word, and verify OMML markers inside the saved .docx.
- Do not produce persistent outputs on success (unless --out-root is provided).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import subprocess
import shutil
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
import re

from lib.tools.build_chromium_extension import build as build_chromium_extension  # type: ignore
from lib.tools.capture_extension_payload import run as capture_payload  # type: ignore


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
    """
    Choose a deterministic selector for selection/copy.

    Priority:
    1) explicit <meta name="copy-office-format-selector" content="...">
    2) common known containers
    3) body
    """
    try:
        head = html_path.read_text(encoding="utf-8", errors="ignore")[:250_000]
    except Exception:
        return "body"

    # Meta override (very small parser; no deps).
    marker = 'name="copy-office-format-selector"'
    i = head.find(marker)
    if i >= 0:
        # look for content="..."
        j = head.find('content="', i)
        if j >= 0:
            j += len('content="')
            k = head.find('"', j)
            if k > j:
                sel = head[j:k].strip()
                if sel:
                    return sel

    # Heuristic: many fixtures wrap selectable content in an element whose id includes "content".
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
            # tag selector - assume present
            if f"<{sel}" in head:
                return sel

    return "body"


def _discover_examples(examples_dir: Path) -> list[ExampleCase]:
    # If an example has a corresponding *_static.html, prefer the static version and skip the non-static one.
    cases: list[ExampleCase] = []
    for html_path in sorted(examples_dir.glob("*.html")):
        if html_path.name.endswith(".html") and not html_path.name.endswith("_static.html"):
            static_candidate = html_path.with_name(f"{html_path.stem}_static.html")
            if static_candidate.exists():
                continue
        name = html_path.stem
        selector = _first_match_selector(html_path)
        cases.append(ExampleCase(name=name, rel_path=f"examples/{html_path.name}", selector=selector))
    return cases


async def _capture_case_payload(case: ExampleCase, out_payload: Path) -> None:
    await capture_payload(
        rel_path=case.rel_path,
        selector=case.selector,
        out_json=out_payload,
        headless=False,
        timeout_ms=60_000,
        show_ui=False,
    )


def _word_paste_case(*, payload_json: Path, out_dir: Path, visible: bool) -> dict[str, bool]:
    # Import Windows-only tooling lazily so this module can be imported on non-Windows.
    from lib.tools.word_paste_probe import (  # type: ignore
        extract_document_xml,
        normalize_cfhtml_utf8,
        set_clipboard_cfhtml,
        word_paste_to_docx,
    )

    payload = json.loads(payload_json.read_text(encoding="utf-8"))
    last = payload.get("lastClipboard") or {}
    cfhtml = last.get("cfhtml") or ""
    plain = last.get("plainText") or " "

    if not cfhtml:
        raise RuntimeError("payload JSON missing lastClipboard.cfhtml")

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "cfhtml.original.txt").write_text(cfhtml, encoding="utf-8")
    (out_dir / "cfhtml.normalized.txt").write_text(normalize_cfhtml_utf8(cfhtml), encoding="utf-8")

    clip_info = set_clipboard_cfhtml(cfhtml=cfhtml, plain_text=plain, normalize=True)
    _write_json(out_dir / "clipboard_set.json", clip_info)

    docx_path = out_dir / "pasted.docx"
    word_paste_to_docx(out_docx=docx_path, visible=visible, timeout_s=60.0)

    xml_path = out_dir / "document.xml"
    xml = extract_document_xml(docx_path, xml_path)

    markers = {
        "has_oMath": "<m:oMath" in xml or "<m:oMathPara" in xml,
        "has_omml_ns": "http://schemas.openxmlformats.org/officeDocument/2006/math" in xml,
    }
    _write_json(out_dir / "verification.json", markers)
    return markers


async def main() -> int:
    parser = argparse.ArgumentParser(description="Generate Word .docx paste artifacts for examples/*.html.")
    parser.add_argument("--examples-dir", default=str(PROJECT_ROOT / "examples"))
    parser.add_argument(
        "--include-large",
        action="store_true",
        help="Include very large HTML files (default skips > 1MB unless a *_static.html exists).",
    )
    parser.add_argument(
        "--out-root",
        default="",
        help="If set, keep artifacts here; otherwise use a temp dir and delete on success.",
    )
    parser.add_argument("--visible", action="store_true", help="Show Word UI while pasting.")
    parser.add_argument("--keep", action="store_true", help="Do not delete previous out-root contents (only used with --out-root).")
    args = parser.parse_args()

    if os.name != "nt":
        print("SKIP: Word paste verification only supported on Windows.")
        return 0

    # Hard precondition: Microsoft Word must be installed (COM registered).
    # If not available, skip (do not fail the suite).
    try:
        probe = subprocess.run(
            ["powershell", "-NoProfile", "-Command", "$ErrorActionPreference='Stop'; $w=New-Object -ComObject Word.Application; $w.Quit();"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if probe.returncode != 0:
            print("SKIP: Microsoft Word COM automation not available on this machine.")
            return 0
    except Exception:
        print("SKIP: Microsoft Word COM automation not available on this machine.")
        return 0

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

    if args.out_root:
        out_root = Path(args.out_root)
        if out_root.exists() and not args.keep:
            shutil.rmtree(out_root, ignore_errors=True)
        out_root.mkdir(parents=True, exist_ok=True)
        cleanup_on_success = False
    else:
        tmp = Path(tempfile.mkdtemp(prefix="copy-office-format-word-"))
        out_root = tmp
        cleanup_on_success = True

    # Ensure dist/chromium is up-to-date (capture tool depends on it).
    build_chromium_extension(PROJECT_ROOT / "dist" / "chromium")

    summary: dict[str, object] = {"cases": {}, "ok": True}
    for case in cases:
        print(f"[case] {case.name}")
        case_dir = out_root / case.name
        payload_json = case_dir / "extension_payload.json"

        await _capture_case_payload(case, payload_json)
        markers = _word_paste_case(payload_json=payload_json, out_dir=case_dir / "word_paste", visible=bool(args.visible))

        ok = bool(markers.get("has_oMath") or markers.get("has_omml_ns"))
        summary["cases"][case.name] = {"payload": str(payload_json), "markers": markers, "ok": ok}
        if not ok:
            summary["ok"] = False
            print(f"FAIL: No OMML markers found for {case.name}. See {case_dir}")
        else:
            print(f"OK: OMML markers found for {case.name}.")

    _write_json(out_root / "summary.json", summary)

    if summary["ok"] and cleanup_on_success:
        try:
            shutil.rmtree(out_root, ignore_errors=True)
        except Exception:
            pass
        return 0

    if not summary["ok"] and cleanup_on_success:
        # Preserve failures for inspection.
        fail_root = PROJECT_ROOT / "artifacts" / "word_examples_failures" / str(int(time.time()))
        fail_root.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(out_root), str(fail_root))
        print(f"FAIL: preserved artifacts at {fail_root}")
        return 1

    # Kept outputs due to --out-root.
    return 0 if summary["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
