"""
Validate a CF_HTML ("HTML Format") payload on disk.

Usage examples:
  - Validate a binary capture from WinHex:
      uv run python tools/validate_cf_html.py --in test.bin
  - Validate a text file containing CF_HTML:
      uv run python tools/validate_cf_html.py --in clipboard_cfhtml.txt
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from tools.cf_html import sha256_hex, validate_cf_html_bytes


def main() -> int:
    ap = argparse.ArgumentParser(description="Validate CF_HTML (Windows HTML Format) offsets/markers.")
    ap.add_argument("--in", dest="in_path", required=True, help="Path to CF_HTML bytes (txt or bin).")
    ap.add_argument("--json", dest="json_path", default="", help="Write full report JSON to this path.")
    args = ap.parse_args()

    in_path = Path(args.in_path)
    raw = in_path.read_bytes()
    report = validate_cf_html_bytes(raw)
    report["sha256"] = sha256_hex(raw.split(b"\x00", 1)[0])
    report["bytes_len"] = len(raw.split(b"\x00", 1)[0])

    if args.json_path:
        out = Path(args.json_path)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    # Compact human summary
    ok = bool(report.get("ok"))
    print(f"ok={ok} bytes_len={report.get('bytes_len')} sha256={report.get('sha256')}")
    for e in report.get("errors") or []:
        print(f"ERROR: {e}")

    offsets = report.get("offsets") or {}
    if offsets:
        keys = ["StartHTML", "EndHTML", "StartFragment", "EndFragment", "StartSelection", "EndSelection"]
        for k in keys:
            if k in offsets:
                print(f"{k}={offsets[k]}")

    chosen = (report.get("markers") or {}).get("chosen_start_marker_pos"), (report.get("markers") or {}).get(
        "chosen_end_marker_pos"
    )
    if any(x is not None for x in chosen):
        print(f"chosen_markers={chosen[0]}..{chosen[1]}")

    return 0 if ok else 2


if __name__ == "__main__":
    raise SystemExit(main())
