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

uv run python test_automated.py "$@"

if [ $? -eq 0 ]; then
    echo ""
    echo "All tests passed!"
else
    echo ""
    echo "Some tests failed. Check output above."
    exit 1
fi
