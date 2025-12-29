"""
Deterministic guardrails for shipping budgets.

Policy (hard):
- `extension/content-script.js` must be <= 20 KB (20_000 bytes).
"""

from __future__ import annotations

import argparse
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    parser = argparse.ArgumentParser(description="Check JS size budgets (deterministic).")
    parser.add_argument("--max-bytes", type=int, default=20_000)
    args = parser.parse_args()

    path = PROJECT_ROOT / "extension" / "content-script.js"
    if not path.exists():
        raise SystemExit(f"missing: {path}")

    size = path.stat().st_size
    if size > int(args.max_bytes):
        raise SystemExit(f"FAIL: {path} is {size} bytes (max {args.max_bytes})")

    print(f"OK: {path} is {size} bytes (max {args.max_bytes})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
