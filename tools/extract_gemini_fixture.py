"""
Extract a deterministic, offline-safe Gemini selection fixture from a full saved page.

Why:
- Full Gemini HTML dumps typically execute scripts that clear/replace SSR content when opened
  from localhost/file://, so the response subtree disappears and selection/copy becomes non-reproducible.
- For extension testing we only need the visible response subtree (and KaTeX markup), not the app shell.

Rule alignment:
- Produces an inspectable artifact (static HTML) that can be selected deterministically.

Usage:
  uv run python tools/extract_gemini_fixture.py --in selection_example.html --out selection_example_static.html
  uv run python tools/capture_extension_payload.py --path selection_example_static.html --selector "#extended-response-markdown-content" --out artifacts/gemini_payload.json
"""

from __future__ import annotations

import argparse
from pathlib import Path


def _find_start_tag(html: str, needle: str) -> tuple[int, int, str]:
    """Return (tag_start_idx, tag_end_idx_inclusive, tag_name) for the element containing needle."""
    idx = html.find(needle)
    if idx < 0:
        raise ValueError(f"Needle not found: {needle!r}")

    # Scan backward for the start of the containing tag: "<"
    tag_start = html.rfind("<", 0, idx)
    if tag_start < 0:
        raise ValueError("Could not find tag start '<' for needle")

    tag_end = html.find(">", idx)
    if tag_end < 0:
        raise ValueError("Could not find tag end '>' for needle")

    # Parse tag name: <div ...>
    i = tag_start + 1
    while i < len(html) and html[i].isspace():
        i += 1
    j = i
    while j < len(html) and (html[j].isalnum() or html[j] in "-:"):
        j += 1
    tag_name = html[i:j].lower()
    if not tag_name:
        raise ValueError("Could not parse tag name at needle tag")

    return tag_start, tag_end, tag_name


def _extract_balanced_element(html: str, tag_start: int, tag_name: str) -> str:
    """Extract outerHTML for an element starting at tag_start by balancing <tag>...</tag>."""
    # Find end of opening tag.
    open_end = html.find(">", tag_start)
    if open_end < 0:
        raise ValueError("Opening tag not closed")

    # Self-closing?
    if html[open_end - 1] == "/":
        return html[tag_start : open_end + 1]

    depth = 0
    i = tag_start
    n = len(html)
    open_pat = f"<{tag_name}"
    close_pat = f"</{tag_name}"

    while i < n:
        next_open = html.find(open_pat, i)
        next_close = html.find(close_pat, i)

        if next_close < 0:
            raise ValueError(f"Unbalanced element: missing closing tag </{tag_name}>")

        if next_open != -1 and next_open < next_close:
            # Found an opening tag. Ensure it is a real tag boundary.
            # e.g. "<divx" shouldn't count as "<div".
            after = next_open + len(open_pat)
            if after < n and html[after] not in (">", " ", "\t", "\r", "\n", "/"):
                i = after
                continue

            depth += 1
            i = after
            continue

        # Found a closing tag.
        # We only start counting after we see the first opening tag at tag_start.
        if next_close == tag_start:
            raise ValueError("Unexpected: closing tag found at element start")

        if depth == 0:
            # We haven't counted the initial opening tag yet; count it now.
            depth = 1

        depth -= 1
        close_end = html.find(">", next_close)
        if close_end < 0:
            raise ValueError("Closing tag not closed")

        i = close_end + 1
        if depth == 0:
            return html[tag_start:i]

    raise ValueError("Unbalanced element: reached EOF")


def build_fixture(*, src: Path, dst: Path) -> None:
    html = src.read_text(encoding="utf-8", errors="ignore")
    needle = 'id="extended-response-markdown-content"'
    tag_start, _tag_end, tag_name = _find_start_tag(html, needle)
    fragment = _extract_balanced_element(html, tag_start, tag_name)

    out = (
        "<!doctype html>\n"
        "<html lang=\"en\">\n"
        "<head>\n"
        "  <meta charset=\"utf-8\" />\n"
        "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />\n"
        "  <title>Gemini Selection Fixture (static)</title>\n"
        "  <style>body{font-family:system-ui,Segoe UI,Arial,sans-serif;line-height:1.35;padding:24px;max-width:1000px;margin:0 auto}</style>\n"
        "</head>\n"
        "<body>\n"
        f"{fragment}\n"
        "</body>\n"
        "</html>\n"
    )

    dst.write_text(out, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract static Gemini response fixture from a full saved page.")
    parser.add_argument("--in", dest="src", default="selection_example.html", help="Input HTML file (full Gemini page dump).")
    parser.add_argument("--out", dest="dst", default="selection_example_static.html", help="Output HTML file (static subtree fixture).")
    args = parser.parse_args()

    src = Path(args.src)
    dst = Path(args.dst)
    if not src.exists():
        raise SystemExit(f"Input not found: {src}")

    build_fixture(src=src, dst=dst)
    print(f"OK: wrote {dst}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

