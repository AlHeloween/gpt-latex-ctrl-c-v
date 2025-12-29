"""
Probe a single large example end-to-end:

1) Load the example in Chromium with the extension.
2) Select all (via CSS selector) and trigger the extension copy path.
3) Paste into Microsoft Word via COM and save a .docx.
4) Generate an expected .docx from the extension-produced wrapped HTML (pure Rust).
5) Compare Word-pasted vs expected by inspecting saved artifacts.

Outputs are written under test_results/continuity_probe/<case>/.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import subprocess
import zipfile
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path

from lib.tools.capture_extension_payload import run as capture_payload  # type: ignore
from lib.tools.word_paste_probe import (  # type: ignore
    extract_document_xml,
    set_clipboard_cfhtml,
    word_paste_to_docx,
)


PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _build_docx_tool() -> Path:
    manifest = PROJECT_ROOT / "lib" / "rust" / "docx_from_html" / "Cargo.toml"
    out_dir = PROJECT_ROOT / "lib" / "rust" / "docx_from_html" / "target" / "release"
    exe = out_dir / ("docx_from_html.exe" if os.name == "nt" else "docx_from_html")
    if exe.exists():
        return exe
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


def _docx_xml(docx_path: Path) -> str:
    with zipfile.ZipFile(docx_path, "r") as z:
        return z.read("word/document.xml").decode("utf-8", errors="replace")


def _xml_unescape(s: str) -> str:
    return (
        s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
        .replace("&quot;", '"')
        .replace("&apos;", "'")
    )


def _docx_text_from_xml(xml: str) -> str:
    parts: list[str] = []
    # Preserve explicit breaks to make tail checks more reliable.
    xml = xml.replace("<w:br/>", "\n").replace("<w:cr/>", "\n").replace("<w:tab/>", "\t")
    for m in re.finditer(r"(?is)<w:t\b[^>]*>(.*?)</w:t>", xml):
        parts.append(_xml_unescape(m.group(1)))
    return "".join(parts)


class _TextStripper(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._chunks: list[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs) -> None:  # noqa: ANN001
        if tag.lower() in {"script", "style"}:
            self._skip_depth += 1

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in {"script", "style"} and self._skip_depth > 0:
            self._skip_depth -= 1

    def handle_data(self, data: str) -> None:
        if self._skip_depth:
            return
        if data and data.strip():
            self._chunks.append(data)

    def text(self) -> str:
        return " ".join(self._chunks)


def _html_to_text(html: str) -> str:
    p = _TextStripper()
    p.feed(html or "")
    return p.text()


@dataclass(frozen=True)
class CompareSummary:
    word_xml_len: int
    expected_xml_len: int
    word_has_tail_anchor: bool
    expected_has_tail_anchor: bool
    tail_anchor: str
    word_text_len: int
    expected_text_len: int
    word_has_tail_snippet: bool
    tail_snippet: str


def _pick_tail_anchor(text: str) -> str:
    toks = [t for t in re.split(r"\s+", text or "") if len(t) >= 8]
    if not toks:
        return ""
    return toks[-1]


def _pick_tail_snippet(text: str, n: int = 200) -> str:
    t = re.sub(r"\s+", " ", (text or "").strip())
    if not t:
        return ""
    return t[-n:]


def _compare(*, word_docx: Path, expected_docx: Path, source_text: str) -> CompareSummary:
    word_xml = _docx_xml(word_docx)
    exp_xml = _docx_xml(expected_docx)
    word_text = _docx_text_from_xml(word_xml)
    exp_text = _docx_text_from_xml(exp_xml)
    norm_word = re.sub(r"\s+", " ", word_text.strip())
    norm_exp = re.sub(r"\s+", " ", exp_text.strip())
    anchor = _pick_tail_anchor(source_text)
    snippet = _pick_tail_snippet(source_text, n=200)
    return CompareSummary(
        word_xml_len=len(word_xml),
        expected_xml_len=len(exp_xml),
        word_has_tail_anchor=(anchor in word_xml) if anchor else False,
        expected_has_tail_anchor=(anchor in exp_xml) if anchor else False,
        tail_anchor=anchor,
        word_text_len=len(word_text),
        expected_text_len=len(exp_text),
        word_has_tail_snippet=(snippet in norm_word) if snippet else False,
        tail_snippet=snippet,
    )


async def main() -> int:
    parser = argparse.ArgumentParser(description="Probe Document_Continuity Word paste vs expected.")
    parser.add_argument("--rel-path", default="examples/2025-12-28-Document_Continuity.html")
    parser.add_argument("--selector", default="body", help="Element to select (Select All ~= body).")
    parser.add_argument("--out-root", default=str(PROJECT_ROOT / "test_results" / "continuity_probe"))
    parser.add_argument("--show-ui", action="store_true", help="Show Chromium/Word windows (default off-screen/hidden).")
    args = parser.parse_args()

    if os.name != "nt":
        raise SystemExit("Windows-only (needs Word COM).")

    rel_path = str(args.rel_path).replace("\\", "/").lstrip("/")
    case_name = Path(rel_path).stem
    out_dir = Path(args.out_root) / case_name
    out_dir.mkdir(parents=True, exist_ok=True)

    payload_json = out_dir / "extension_payload.json"
    await capture_payload(
        rel_path=rel_path,
        selector=str(args.selector) if args.selector else None,
        out_json=payload_json,
        headless=False,
        timeout_ms=120_000,
        show_ui=bool(args.show_ui),
    )

    payload = json.loads(payload_json.read_text(encoding="utf-8"))
    last = payload.get("lastClipboard") or {}
    cfhtml = str(last.get("cfhtml") or "")
    wrapped = str(last.get("wrappedHtml") or "")
    plain = str(last.get("plainText") or " ")

    if not cfhtml:
        raise SystemExit("Missing lastClipboard.cfhtml in payload (copy failed or bridge truncated).")

    (out_dir / "wrapped.html").write_text(wrapped, encoding="utf-8")
    (out_dir / "cfhtml.txt").write_text(cfhtml, encoding="utf-8")

    # 1) Paste into Word via COM.
    clip_info = set_clipboard_cfhtml(cfhtml=cfhtml, plain_text=plain if plain else " ", normalize=True)
    _write_json(out_dir / "clipboard_set.json", clip_info)
    word_docx = out_dir / "word_paste.docx"
    word_paste_to_docx(out_docx=word_docx, visible=bool(args.show_ui), timeout_s=120.0)
    extract_document_xml(word_docx, out_dir / "word_document.xml")

    # 2) Generate expected docx from wrapped HTML using the pure-Rust generator.
    exe = _build_docx_tool()
    expected_html = out_dir / "expected_input.html"
    expected_html.write_text(wrapped if wrapped else "<html><body></body></html>", encoding="utf-8")
    expected_docx = out_dir / "expected.docx"
    proc = subprocess.run(
        [str(exe), "--html-file", str(expected_html), "--out", str(expected_docx), "--title", case_name],
        cwd=str(PROJECT_ROOT),
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stdout + "\n" + proc.stderr)
    extract_document_xml(expected_docx, out_dir / "expected_document.xml")

    # 3) Compare.
    src_text = _html_to_text(wrapped)
    summary = _compare(word_docx=word_docx, expected_docx=expected_docx, source_text=src_text)
    _write_json(out_dir / "compare_summary.json", summary.__dict__)

    print(f"OK: wrote {out_dir}")
    print(
        f"word_xml_len={summary.word_xml_len} expected_xml_len={summary.expected_xml_len} "
        f"tail_anchor={summary.tail_anchor!r} word_has_tail_snippet={summary.word_has_tail_snippet}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
