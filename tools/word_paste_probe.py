"""
Paste CF_HTML into Microsoft Word and verify the result via saved .docx artifacts.

This avoids black-box "it probably pasted" checks:
- Precondition: Word is installed and clipboard can be set.
- Action: set clipboard with HTML Format (+ UnicodeText), open Word via COM, paste, save docx.
- Postcondition: inspect saved docx's word/document.xml for OMML markers.

Notes:
- Uses stdlib clipboard via ctypes + Word automation via PowerShell COM.
- Does not require pywin32.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import zipfile
from pathlib import Path
from typing import Any

import ctypes
from ctypes import wintypes


GMEM_MOVEABLE = 0x0002
CF_UNICODETEXT = 13


kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
user32 = ctypes.WinDLL("user32", use_last_error=True)


def _check_win(ok: bool, msg: str) -> None:
    if ok:
        return
    err = ctypes.get_last_error()
    raise RuntimeError(f"{msg} (winerr={err})")


def _set_clipboard_bytes(fmt: int, data: bytes) -> None:
    hglobal = kernel32.GlobalAlloc(GMEM_MOVEABLE, len(data))
    _check_win(bool(hglobal), "GlobalAlloc failed")
    ptr = kernel32.GlobalLock(hglobal)
    _check_win(bool(ptr), "GlobalLock failed")
    try:
        ctypes.memmove(ptr, data, len(data))
    finally:
        kernel32.GlobalUnlock(hglobal)

    # After SetClipboardData, the system owns the handle; do not free it.
    hres = user32.SetClipboardData(fmt, hglobal)
    _check_win(bool(hres), "SetClipboardData failed")


def set_clipboard_cfhtml(*, cfhtml: str, plain_text: str, normalize: bool) -> dict[str, Any]:
    fmt_html = user32.RegisterClipboardFormatW("HTML Format")
    _check_win(fmt_html != 0, "RegisterClipboardFormatW(HTML Format) failed")

    # Most consumers (including Word) expect CF_HTML offsets measured in bytes of the encoded payload.
    # Normalize to UTF-8 byte offsets to avoid "clipboard operation did not succeed" failures.
    to_write = normalize_cfhtml_utf8(cfhtml) if normalize else cfhtml
    html_bytes = to_write.encode("utf-8") + b"\x00"
    text_bytes = plain_text.encode("utf-16le") + b"\x00\x00"

    _check_win(bool(user32.OpenClipboard(None)), "OpenClipboard failed")
    try:
        _check_win(bool(user32.EmptyClipboard()), "EmptyClipboard failed")
        _set_clipboard_bytes(fmt_html, html_bytes)
        _set_clipboard_bytes(CF_UNICODETEXT, text_bytes)
    finally:
        user32.CloseClipboard()

    return {
        "html_format_id": int(fmt_html),
        "html_bytes": len(html_bytes),
        "text_bytes": len(text_bytes),
        "normalized": bool(normalize),
    }


def normalize_cfhtml_utf8(cfhtml: str) -> str:
    """
    Rebuild CF_HTML header offsets as UTF-8 byte offsets.

    We extract the fragment between <!--StartFragment--> and <!--EndFragment--> and re-emit a fresh header.
    If parsing fails, return the input unchanged.
    """
    start_marker = "<!--StartFragment-->"
    end_marker = "<!--EndFragment-->"
    start_i = cfhtml.find(start_marker)
    end_i = cfhtml.find(end_marker)
    if start_i == -1 or end_i == -1 or end_i < start_i:
        return cfhtml

    # Extract source URL (optional).
    source_url = ""
    for line in cfhtml.splitlines():
        if line.startswith("SourceURL:"):
            source_url = line[len("SourceURL:") :].strip()
            break

    full_html = cfhtml[start_i + len(start_marker) : end_i]
    html = f"{start_marker}{full_html}{end_marker}"

    src_line = f"SourceURL:{source_url}\r\n" if source_url else ""
    placeholder = "0000000000"
    header = (
        "Version:1.0\r\n"
        f"StartHTML:{placeholder}\r\n"
        f"EndHTML:{placeholder}\r\n"
        f"StartFragment:{placeholder}\r\n"
        f"EndFragment:{placeholder}\r\n"
        f"{src_line}"
    )

    def blen(s: str) -> int:
        return len(s.encode("utf-8"))

    header_bytes = blen(header)
    start_html = header_bytes
    start_fragment = start_html + blen(start_marker)
    end_fragment = start_fragment + blen(full_html)
    end_html = start_html + blen(html)

    def pad(n: int) -> str:
        return str(n).rjust(10, "0")

    header = (
        "Version:1.0\r\n"
        f"StartHTML:{pad(start_html)}\r\n"
        f"EndHTML:{pad(end_html)}\r\n"
        f"StartFragment:{pad(start_fragment)}\r\n"
        f"EndFragment:{pad(end_fragment)}\r\n"
        f"{src_line}"
    )

    return header + html


def word_paste_to_docx(*, out_docx: Path, visible: bool, timeout_s: float = 60.0) -> None:
    out_docx.parent.mkdir(parents=True, exist_ok=True)
    out_docx = out_docx.resolve()
    out_ps = str(out_docx).replace("'", "''")

    # PowerShell COM avoids extra Python deps and runs in STA by default.
    # wdFormatDocumentDefault = 16 (docx)
    ps = f"""
$ErrorActionPreference = 'Stop'
$out = '{out_ps}'
$word = New-Object -ComObject Word.Application
try {{
  $word.Visible = {'$true' if visible else '$false'}
  $doc = $word.Documents.Add()
  try {{
    $word.Selection.Paste()
    $doc.SaveAs([ref]$out, [ref]16)
  }} finally {{
    $doc.Close($false) | Out-Null
  }}
}} finally {{
  $word.Quit() | Out-Null
}}
"""
    try:
        subprocess.run(
            ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
            check=True,
            capture_output=True,
            text=True,
            timeout=float(timeout_s) if timeout_s else None,
        )
    except subprocess.CalledProcessError as e:
        stdout = (e.stdout or "").strip()
        stderr = (e.stderr or "").strip()
        details = "\n".join(
            [
                "PowerShell Word automation failed.",
                f"exit_code={e.returncode}",
                f"stdout={stdout if stdout else '<empty>'}",
                f"stderr={stderr if stderr else '<empty>'}",
            ]
        )
        raise RuntimeError(details) from e
    except subprocess.TimeoutExpired as e:
        raise RuntimeError(f"PowerShell Word automation timed out after {timeout_s}s") from e


def extract_document_xml(docx_path: Path, out_xml: Path) -> str:
    with zipfile.ZipFile(docx_path, "r") as zf:
        xml = zf.read("word/document.xml").decode("utf-8", errors="replace")
    out_xml.parent.mkdir(parents=True, exist_ok=True)
    out_xml.write_text(xml, encoding="utf-8")
    return xml


def main() -> int:
    parser = argparse.ArgumentParser(description="Paste CF_HTML into Word and verify OMML in saved docx.")
    parser.add_argument(
        "--payload-json",
        default=str(Path("artifacts") / "extension_payload.json"),
        help="JSON from tools/capture_extension_payload.py (contains lastClipboard).",
    )
    parser.add_argument("--out-dir", default=str(Path("artifacts") / "word_paste"))
    parser.add_argument("--visible", action="store_true", help="Show Word UI while pasting.")
    parser.add_argument("--no-normalize", action="store_true", help="Use cfhtml offsets as-is (no UTF-8 normalization).")
    args = parser.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    payload = json.loads(Path(args.payload_json).read_text(encoding="utf-8"))
    last = payload.get("lastClipboard") or {}
    cfhtml = last.get("cfhtml") or ""
    plain = last.get("plainText") or ""

    if not cfhtml:
        raise SystemExit("ERROR: payload JSON missing lastClipboard.cfhtml")
    if not plain:
        plain = " "

    normalized = normalize_cfhtml_utf8(cfhtml)
    (out_dir / "cfhtml.normalized.txt").write_text(normalized, encoding="utf-8")
    (out_dir / "cfhtml.original.txt").write_text(cfhtml, encoding="utf-8")
    clip_info = set_clipboard_cfhtml(cfhtml=cfhtml, plain_text=plain, normalize=not bool(args.no_normalize))
    (out_dir / "clipboard_set.json").write_text(json.dumps(clip_info, indent=2), encoding="utf-8")

    docx_path = out_dir / "pasted.docx"
    word_paste_to_docx(out_docx=docx_path, visible=bool(args.visible))

    xml_path = out_dir / "document.xml"
    xml = extract_document_xml(docx_path, xml_path)

    # Observable postcondition: detect OMML in output.
    # Word commonly uses these namespaces/elements for equations:
    # - m:oMath, m:oMathPara, or the OMML namespace URI.
    markers = {
        "has_oMath": "<m:oMath" in xml or "<m:oMathPara" in xml,
        "has_omml_ns": "http://schemas.openxmlformats.org/officeDocument/2006/math" in xml,
    }
    (out_dir / "verification.json").write_text(json.dumps(markers, indent=2), encoding="utf-8")

    if not (markers["has_oMath"] or markers["has_omml_ns"]):
        raise SystemExit(f"FAIL: No OMML markers found. See {out_dir}")

    print(f"OK: Word paste produced OMML. See {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
