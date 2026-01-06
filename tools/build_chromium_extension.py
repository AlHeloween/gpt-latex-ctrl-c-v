import json
import shutil
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
EXTENSION_ROOT = PROJECT_ROOT / "extension"
MANIFEST_SOURCE = EXTENSION_ROOT / "manifest.chromium.json"

DEFAULT_OUT_DIR = PROJECT_ROOT / "dist" / "chromium"

COPY_ITEMS = [
    "background.js",
    "content-script.js",
    "constants.js",
    "offscreen.html",
    "offscreen.js",
    "popup.html",
    "popup.js",
    "options.html",
    "options.js",
    "lib",
    "assets",
    "icons",
    "wasm",
]


def _copy_item(src: Path, dst: Path) -> None:
    if src.is_dir():
        if dst.exists():
            shutil.rmtree(dst)
        shutil.copytree(src, dst)
    else:
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)


def build(out_dir: Path = DEFAULT_OUT_DIR) -> Path:
    out_dir = out_dir.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    if not MANIFEST_SOURCE.exists():
        raise FileNotFoundError(f"Missing {MANIFEST_SOURCE}")

    manifest = json.loads(MANIFEST_SOURCE.read_text(encoding="utf-8"))
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    for item in COPY_ITEMS:
        src = EXTENSION_ROOT / item
        if not src.exists():
            raise FileNotFoundError(f"Missing {src}")
        _copy_item(src, out_dir / item)

    return out_dir


if __name__ == "__main__":
    built = build()
    print(str(built))
