#!/bin/bash
# Initialize development environment for GPT LATEX Ctrl-C Ctrl-V extension
# This script sets up Python dependencies, Playwright browsers, and verifies tools

set -e  # Exit on error

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "========================================"
echo "GPT LATEX Ctrl-C Ctrl-V"
echo "Development Environment Initialization"
echo "========================================"
echo ""

# Check if uv is installed
echo "[1/5] Checking uv (Python package manager)..."
if ! command -v uv &> /dev/null; then
    echo "[ERROR] uv is not installed or not in PATH."
    echo ""
    echo "Please install uv first:"
    echo "  curl -LsSf https://astral.sh/uv/install.sh | sh"
    echo "  Or visit: https://github.com/astral-sh/uv"
    echo ""
    exit 1
fi
echo "[OK] uv found"
uv --version
echo ""

# Check Python version
echo "[2/5] Checking Python version..."
if ! uv run python --version; then
    echo "[ERROR] Python check failed."
    exit 1
fi
echo "[OK] Python is available"
echo ""

# Sync dependencies
echo "[3/5] Installing Python dependencies (uv sync)..."
cd "$PROJECT_ROOT"
if ! uv sync; then
    echo "[ERROR] Failed to sync dependencies."
    exit 1
fi
echo "[OK] Dependencies installed"
echo ""

# Install Playwright browsers
echo "[4/5] Installing Playwright browsers (chromium)..."
if uv run playwright install chromium; then
    echo "[OK] Playwright browsers installed"
else
    echo "[WARNING] Playwright browser installation failed or skipped."
    echo "          This is OK if browsers are already installed."
fi
echo ""

# Check Rust (optional, for WASM builds)
echo "[5/5] Checking Rust (for WASM builds)..."
if command -v rustc &> /dev/null; then
    rustc --version
    echo "[OK] Rust is available (WASM builds can be performed)"
else
    echo "[INFO] Rust not found. WASM builds will require Rust installation."
    echo "       Install from: https://www.rust-lang.org/tools/install"
fi
echo ""

# Verify build tools
echo "========================================"
echo "Verifying build tools..."
echo "========================================"
echo ""

echo "Checking build scripts..."
if [ -f "$PROJECT_ROOT/tools/build_rust_wasm.py" ]; then
    echo "[OK] build_rust_wasm.py found"
else
    echo "[WARNING] build_rust_wasm.py not found"
fi

if [ -f "$PROJECT_ROOT/tools/build_firefox_xpi.py" ]; then
    echo "[OK] build_firefox_xpi.py found"
else
    echo "[WARNING] build_firefox_xpi.py not found"
fi

if [ -f "$PROJECT_ROOT/tools/build_chromium_extension.py" ]; then
    echo "[OK] build_chromium_extension.py found"
else
    echo "[WARNING] build_chromium_extension.py not found"
fi
echo ""

# Optional: Build WASM if Rust is available
if command -v rustc &> /dev/null; then
    echo "========================================"
    echo "Building WASM module (optional)..."
    echo "========================================"
    echo ""
    echo "Building Rust WASM module..."
    if uv run python "$PROJECT_ROOT/tools/build_rust_wasm.py"; then
        echo "[OK] WASM module built successfully"
    else
        echo "[WARNING] WASM build failed. This is OK if you don't need WASM yet."
    fi
    echo ""
fi

echo "========================================"
echo "Initialization Complete!"
echo "========================================"
echo ""
echo "Next steps:"
echo "  1. Run tests:     ./tests/run_tests.sh"
echo "  2. Build Firefox: uv run python tools/build_firefox_xpi.py --out dist/gpt-latex-ctrl-c-v.xpi"
echo "  3. Build Chromium: uv run python tools/build_chromium_extension.py"
echo ""
echo "For more information, see README.md"
echo ""

