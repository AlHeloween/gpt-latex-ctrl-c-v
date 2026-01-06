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
import hashlib
import json
import os
import time
from pathlib import Path
from typing import Any

import ctypes
from ctypes import wintypes

from tools.cf_html import parse_offsets_from_bytes, validate_cf_html_bytes  # type: ignore

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


def _parse_cf_html_bytes(raw: bytes) -> dict[str, Any]:
    """
    Parse CF_HTML bytes and return {header, html, fragment, source_url}.

    - Uses StartHTML/EndHTML when present (for header slicing).
    - Extracts fragment between the first StartFragment marker and the first EndFragment marker after it.
    - If parsing fails, returns best-effort fields.
    """
    out: dict[str, Any] = {"header": "", "html": "", "fragment": "", "source_url": ""}
    if not raw:
        return out

    raw = raw.split(b"\x00", 1)[0]
    offsets = parse_offsets_from_bytes(raw).offsets
    start_html = offsets.get("StartHTML")
    end_html = offsets.get("EndHTML")
    start_frag = offsets.get("StartFragment")
    end_frag = offsets.get("EndFragment")

    header_bytes = b""
    html_bytes = raw
    if start_html is not None and end_html is not None and 0 <= start_html <= end_html <= len(raw):
        header_bytes = raw[:start_html]
        html_bytes = raw[start_html:end_html]

    try:
        header_text = header_bytes.decode("ascii", errors="ignore")
        for line in header_text.splitlines():
            if line.startswith("SourceURL:"):
                out["source_url"] = line[len("SourceURL:") :].strip()
                break
    except Exception:
        pass

    # Prefer offsets for fragment extraction (marker-free producers exist).
    if (
        start_frag is not None
        and end_frag is not None
        and 0 <= start_frag <= end_frag <= len(raw)
        and (start_html is None or start_frag >= start_html)
        and (end_html is None or end_frag <= end_html)
    ):
        frag_bytes = raw[start_frag:end_frag]
        # If offsets include comment markers, strip a single layer (best-effort).
        low = frag_bytes.lower()
        if low.startswith(b"<!--startfragment"):
            j = low.find(b"-->")
            if j >= 0:
                frag_bytes = frag_bytes[j + 3 :]
        low = frag_bytes.lower()
        if low.endswith(b"-->") and b"<!--endfragment" in low[-80:]:
            k = low.rfind(b"<!--endfragment")
            if k >= 0:
                frag_bytes = frag_bytes[:k]
        out["header"] = header_bytes.decode("utf-8", errors="replace") if header_bytes else ""
        out["html"] = html_bytes.decode("utf-8", errors="replace")
        out["fragment"] = frag_bytes.decode("utf-8", errors="replace")
        return out

    # Fallback: marker-based extraction within the HTML payload (best-effort).
    lower = html_bytes.lower()
    start_pos = lower.find(b"<!--startfragment")
    if start_pos >= 0:
        start_end = lower.find(b"-->", start_pos)
        if start_end >= 0:
            end_pos = lower.find(b"<!--endfragment", start_end + 3)
            if end_pos >= 0:
                out["header"] = header_bytes.decode("utf-8", errors="replace") if header_bytes else ""
                out["html"] = html_bytes.decode("utf-8", errors="replace")
                out["fragment"] = html_bytes[start_end + 3 : end_pos].decode("utf-8", errors="replace")
                return out

    # Best-effort fallback.
    out["html"] = html_bytes.decode("utf-8", errors="replace")
    out["header"] = header_bytes.decode("utf-8", errors="replace") if header_bytes else ""
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
        html_bytes = b""
        if raw_html is not None:
            # CF_HTML is typically UTF-8 with a trailing NUL.
            html_bytes = raw_html.split(b"\x00", 1)[0]
            html_text = html_bytes.decode("utf-8", errors="replace")

        plain_text = ""
        if raw_text is not None:
            # UTF-16LE with a trailing NUL (terminated on a 2-byte boundary).
            b = raw_text
            end = None
            for i in range(0, max(0, len(b) - 1), 2):
                if b[i] == 0 and b[i + 1] == 0:
                    end = i
                    break
            if end is None:
                end = len(b) - (len(b) % 2)
            plain_text = b[:end].decode("utf-16le", errors="replace")

        parsed = _parse_cf_html_bytes(html_bytes)
        validation = validate_cf_html_bytes(html_bytes) if html_bytes else {"ok": False, "errors": ["no HTML Format bytes"]}

        return {
            "formats": [{"id": int(f), "name": _format_name(int(f))} for f in formats],
            "html_format_id": int(fmt_html),
            "open_clipboard_attempts": open_attempts,
            "open_clipboard_last_winerr": int(last_err),
            "has_html_format": raw_html is not None,
            "has_unicode_text": raw_text is not None,
            "cfhtml_bytes_length": int(len(html_bytes)) if html_bytes else 0,
            "cfhtml_bytes_sha256": hashlib.sha256(html_bytes).hexdigest() if html_bytes else "",
            "cfhtml_length": len(html_text),
            "plain_length": len(plain_text),
            "cfhtml_preview": html_text[:400],
            "plain_preview": plain_text[:200],
            "cfhtml": html_text,
            "plain_text": plain_text,
            "fragment": parsed.get("fragment", ""),
            "source_url": parsed.get("source_url", ""),
            "cfhtml_validation": validation,
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

    # Preserve exact newline bytes (CF_HTML and CF_UNICODETEXT commonly contain "\r\n").
    # On Windows, default newline translation would turn "\r\n" into "\r\r\n".
    def _write_text_exact(path: Path, text: str) -> None:
        with open(path, "w", encoding="utf-8", newline="") as f:
            f.write(text)

    _write_text_exact(out_dir / "cfhtml.txt", str(data.get("cfhtml", "")))
    _write_text_exact(out_dir / "fragment.html", str(data.get("fragment", "")))
    _write_text_exact(out_dir / "plain.txt", str(data.get("plain_text", "")))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
