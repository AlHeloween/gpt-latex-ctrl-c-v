#!/bin/bash
# Run fully automated tests for the extension
# Using uv package manager

echo "Checking uv environment..."
uv --version
uv run python --version

echo ""
echo "Running FULLY AUTOMATED test suite..."
echo "(No manual steps required)"
echo ""
echo "Usage: ./run_tests.sh [--headless] [--debug]"
echo ""

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "Building Rust WASM (tex_to_mathml.wasm)..."
uv run python ../lib/tools/build_rust_wasm.py

echo ""
echo "Checking JS size budgets..."
uv run python ../lib/tools/check_js_size.py

echo ""
uv run python test_automated.py "$@"
TESTS_RC=$?

echo ""
echo "Running Word example verification (skips if Word is not available)..."
uv run python test_word_examples.py
WORD_RC=$?

echo ""
echo "Generating docx outputs from examples to test_results/docx..."
uv run python test_generate_docx_examples.py --include-large
DOCX_RC=$?

echo ""
REAL_CLIP_RC=0
REAL_MD_RC=0
if uv run python -c "import os,sys; sys.exit(0 if os.name=='nt' else 1)"; then
    echo "Running real clipboard -> docx verification (Windows-only; writes test_results/real_clipboard)..."
    uv run python test_real_clipboard_docx.py --include-large
    REAL_CLIP_RC=$?
    echo ""
    echo "Running real clipboard -> markdown verification (Windows-only; writes test_results/real_clipboard_markdown)..."
    uv run python test_real_clipboard_markdown.py
    REAL_MD_RC=$?
else
    echo "Skipping real clipboard -> docx verification (non-Windows)."
fi

if [ $TESTS_RC -eq 0 ]; then
    echo ""
    echo "All tests passed!"
else
    echo ""
    echo "Some tests failed. Check output above."
    exit $TESTS_RC
fi

if [ $WORD_RC -ne 0 ]; then
    exit $WORD_RC
fi

if [ $DOCX_RC -ne 0 ]; then
    exit $DOCX_RC
fi

if [ $REAL_CLIP_RC -ne 0 ]; then
    exit $REAL_CLIP_RC
fi

if [ $REAL_MD_RC -ne 0 ]; then
    exit $REAL_MD_RC
fi

echo ""
echo "Cleaning test_results to keep only the most recent outputs..."
uv run python ../lib/tools/cleanup_test_results.py
