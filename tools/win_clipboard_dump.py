"""
Dump Windows clipboard contents (HTML Format + UnicodeText) into deterministic artifacts.

This is used for "real-life" verification of the extension copy path:
- Precondition: extension wrote to OS clipboard
- Action: read OS clipboard formats and extract CF_HTML fragment
- Postcondition: persist artifacts for inspection (cfhtml.txt, fragment.html, plain.txt, dump.json)

Windows-only.
"""

from __future__ import annotations

import argparse
import json
import os
import time
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


def _read_clipboard_bytes(fmt: int) -> bytes | None:
    if fmt == 0:
        return None
    h = user32.GetClipboardData(fmt)
    if not h:
        return None
    ptr = kernel32.GlobalLock(h)
    if not ptr:
        return None
    try:
        size = kernel32.GlobalSize(h)
        if not size:
            return b""
        return ctypes.string_at(ptr, size)
    finally:
        kernel32.GlobalUnlock(h)


def _list_formats() -> list[int]:
    out: list[int] = []
    fmt = 0
    while True:
        fmt = user32.EnumClipboardFormats(fmt)
        if fmt == 0:
            break
        out.append(int(fmt))
    return out


def _format_name(fmt: int) -> str:
    # Common formats can be named without WinAPI calls.
    if fmt == CF_UNICODETEXT:
        return "CF_UNICODETEXT"
    buf = ctypes.create_unicode_buffer(256)
    n = user32.GetClipboardFormatNameW(fmt, buf, len(buf))
    if n:
        return buf.value
    return f"FORMAT_{fmt}"


def _parse_cf_html(text: str) -> dict[str, Any]:
    """
    Parse CF_HTML and return {header, html, fragment, source_url}.

    If parsing fails, returns best-effort fields.
    """
    out: dict[str, Any] = {"header": "", "html": "", "fragment": "", "source_url": ""}
    if not text:
        return out

    # SourceURL is optional.
    for line in text.splitlines():
        if line.startswith("SourceURL:"):
            out["source_url"] = line[len("SourceURL:") :].strip()
            break

    start_marker = "<!--StartFragment-->"
    end_marker = "<!--EndFragment-->"
    start_i = text.find(start_marker)
    end_i = text.find(end_marker)
    if start_i != -1 and end_i != -1 and end_i > start_i:
        out["header"] = text[:start_i]
        out["html"] = text[start_i : end_i + len(end_marker)]
        out["fragment"] = text[start_i + len(start_marker) : end_i]
        return out

    out["html"] = text
    return out


def dump_clipboard() -> dict[str, Any]:
    if os.name != "nt":
        raise RuntimeError("win_clipboard_dump is Windows-only")

    fmt_html = user32.RegisterClipboardFormatW("HTML Format")
    _check_win(fmt_html != 0, "RegisterClipboardFormatW(HTML Format) failed")

    # Clipboard can be transiently locked by the OS or other apps (including the browser itself).
    # Retry deterministically for a short, bounded window to avoid flaky test failures.
    open_attempts = 0
    last_err = 0
    deadline_s = 2.0
    poll_s = 0.05
    t0 = time.monotonic()
    while True:
        open_attempts += 1
        if bool(user32.OpenClipboard(None)):
            break
        last_err = ctypes.get_last_error()
        if time.monotonic() - t0 >= deadline_s:
            raise RuntimeError(f"OpenClipboard failed (winerr={last_err}, attempts={open_attempts})")
        time.sleep(poll_s)
    try:
        formats = _list_formats()

        raw_html = _read_clipboard_bytes(int(fmt_html))
        raw_text = _read_clipboard_bytes(CF_UNICODETEXT)

        html_text = ""
        if raw_html is not None:
            # CF_HTML is typically UTF-8 with a trailing NUL.
            html_text = raw_html.split(b"\x00", 1)[0].decode("utf-8", errors="replace")

        plain_text = ""
        if raw_text is not None:
            # UTF-16LE with a trailing NUL.
            plain_text = raw_text.split(b"\x00\x00", 1)[0].decode("utf-16le", errors="replace")

        parsed = _parse_cf_html(html_text)

        return {
            "formats": [{"id": int(f), "name": _format_name(int(f))} for f in formats],
            "html_format_id": int(fmt_html),
            "open_clipboard_attempts": open_attempts,
            "open_clipboard_last_winerr": int(last_err),
            "has_html_format": raw_html is not None,
            "has_unicode_text": raw_text is not None,
            "cfhtml_length": len(html_text),
            "plain_length": len(plain_text),
            "cfhtml_preview": html_text[:400],
            "plain_preview": plain_text[:200],
            "cfhtml": html_text,
            "plain_text": plain_text,
            "fragment": parsed.get("fragment", ""),
            "source_url": parsed.get("source_url", ""),
        }
    finally:
        user32.CloseClipboard()


def main() -> int:
    parser = argparse.ArgumentParser(description="Dump Windows clipboard HTML Format + UnicodeText.")
    parser.add_argument("--out-dir", required=True, help="Output directory for artifacts")
    args = parser.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    data = dump_clipboard()

    (out_dir / "dump.json").write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    (out_dir / "cfhtml.txt").write_text(data.get("cfhtml", ""), encoding="utf-8")
    (out_dir / "fragment.html").write_text(data.get("fragment", ""), encoding="utf-8")
    (out_dir / "plain.txt").write_text(data.get("plain_text", ""), encoding="utf-8")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
