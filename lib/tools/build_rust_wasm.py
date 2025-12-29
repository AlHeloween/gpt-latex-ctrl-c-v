"""
Build the Rust -> WebAssembly core converter and write it into extension/wasm/ for extension use.

Determinism:
- Uses Cargo.lock in lib/rust/tex_to_mathml_wasm/ (pinned crate versions).
- Uses explicit wasm32-unknown-unknown target.

Usage:
  uv run python lib/tools/build_rust_wasm.py
  uv run python lib/tools/build_rust_wasm.py --debug
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
CRATE_DIR = PROJECT_ROOT / "lib" / "rust" / "tex_to_mathml_wasm"
OUT_DIR = PROJECT_ROOT / "extension" / "wasm"


def _run(cmd: list[str], *, cwd: Path) -> None:
    subprocess.run(cmd, cwd=str(cwd), check=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Build Rust wasm converter into extension/wasm/.")
    parser.add_argument("--debug", action="store_true", help="Build debug (default is release).")
    args = parser.parse_args()

    profile = "debug" if args.debug else "release"
    build_args = ["cargo", "build", "--locked", "--target", "wasm32-unknown-unknown"]
    if not args.debug:
        build_args.append("--release")

    if not CRATE_DIR.exists():
        raise SystemExit(f"Missing crate dir: {CRATE_DIR}")

    _run(build_args, cwd=CRATE_DIR)

    wasm_src = CRATE_DIR / "target" / "wasm32-unknown-unknown" / profile / "tex_to_mathml_wasm.wasm"
    if not wasm_src.exists():
        raise SystemExit(f"Build did not produce wasm: {wasm_src}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    wasm_dst = OUT_DIR / "tex_to_mathml.wasm"
    shutil.copy2(wasm_src, wasm_dst)
    print(f"OK: wrote {wasm_dst}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
