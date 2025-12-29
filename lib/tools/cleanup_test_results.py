"""
Clean up test_results/ while keeping only the most recent results.

Policy (deterministic):
- Always keep `test_results/docx/` (generated from examples).
- Keep the newest directory matching `real_clipboard*` excluding `real_clipboard_markdown*`.
- Keep the newest directory matching `real_clipboard_markdown*`.
- Delete everything else under `test_results/` (directories and files).

Usage:
  uv run python lib/tools/cleanup_test_results.py
  uv run python lib/tools/cleanup_test_results.py --dry-run
"""

from __future__ import annotations

import argparse
import os
import shutil
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
TEST_RESULTS = PROJECT_ROOT / "test_results"


def _effective_mtime(path: Path) -> float:
    try:
        m = path.stat().st_mtime
    except Exception:
        m = 0.0
    if not path.is_dir():
        return m

    # Directory mtime on Windows can be misleading (overwrites may not bump it).
    # Use max(child mtime) for determinism.
    for root, _dirs, files in os.walk(path):
        for f in files:
            p = Path(root) / f
            try:
                m = max(m, p.stat().st_mtime)
            except Exception:
                pass
    return m


def _pick_newest(dirs: list[Path]) -> Path | None:
    if not dirs:
        return None
    return max(dirs, key=_effective_mtime)


def main() -> int:
    parser = argparse.ArgumentParser(description="Clean test_results/, keeping only the most recent outputs.")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not TEST_RESULTS.exists():
        print(f"OK: nothing to clean (missing {TEST_RESULTS})")
        return 0

    entries = [p for p in TEST_RESULTS.iterdir() if p.name not in {".gitkeep"}]

    keep: set[Path] = set()
    docx = TEST_RESULTS / "docx"
    if docx.exists():
        keep.add(docx)

    clipboard_dirs = [
        p
        for p in entries
        if p.is_dir()
        and p.name.startswith("real_clipboard")
        and not p.name.startswith("real_clipboard_markdown")
    ]
    md_dirs = [p for p in entries if p.is_dir() and p.name.startswith("real_clipboard_markdown")]

    newest_clip = _pick_newest(clipboard_dirs)
    newest_md = _pick_newest(md_dirs)
    if newest_clip:
        keep.add(newest_clip)
    if newest_md:
        keep.add(newest_md)

    removed: list[str] = []
    kept: list[str] = sorted(str(p.relative_to(PROJECT_ROOT)) for p in keep)

    for p in entries:
        if p in keep:
            continue
        rel = str(p.relative_to(PROJECT_ROOT))
        if args.dry_run:
            removed.append(rel)
            continue
        try:
            if p.is_dir():
                shutil.rmtree(p, ignore_errors=False)
            else:
                p.unlink()
            removed.append(rel)
        except Exception as e:
            raise SystemExit(f"Failed to remove {rel}: {e}") from e

    print("Kept:")
    for k in kept:
        print(f"  - {k}")
    print("Removed:")
    for r in sorted(removed):
        print(f"  - {r}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
