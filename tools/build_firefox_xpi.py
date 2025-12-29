"""
Build a Firefox-ready XPI (zip) from the extension/ directory.

AMO expects an archive with manifest.json at the root.

Usage:
  uv run python tools/build_firefox_xpi.py --out dist/copy-as-office-format.xpi
"""

from __future__ import annotations

import argparse
import zipfile
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
EXTENSION_ROOT = PROJECT_ROOT / "extension"


def _should_exclude(rel: str) -> bool:
    rel = rel.replace("\\", "/")
    if rel.endswith("/"):
        return False
    # Keep the package deterministic and small.
    return rel.startswith((".git/", ".venv/", "__pycache__/")) or rel.endswith((".pyc",))


def build(*, out_path: Path) -> Path:
    if not EXTENSION_ROOT.exists():
        raise SystemExit(f"Missing extension dir: {EXTENSION_ROOT}")
    if not (EXTENSION_ROOT / "manifest.json").exists():
        raise SystemExit(f"Missing manifest: {EXTENSION_ROOT / 'manifest.json'}")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path = out_path.resolve()
    if out_path.exists():
        out_path.unlink()

    with zipfile.ZipFile(out_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for path in sorted(EXTENSION_ROOT.rglob("*")):
            if path.is_dir():
                continue
            rel = path.relative_to(EXTENSION_ROOT).as_posix()
            if _should_exclude(rel):
                continue
            zf.write(path, arcname=rel)

    return out_path


def main() -> int:
    parser = argparse.ArgumentParser(description="Build Firefox XPI from extension/.")
    parser.add_argument("--out", default=str(PROJECT_ROOT / "dist" / "copy-as-office-format.xpi"))
    args = parser.parse_args()

    out = build(out_path=Path(args.out))
    print(f"OK: wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
