#!/bin/bash
# Run comprehensive test suite for Copy as Office Format extension

echo "============================================================"
echo "Comprehensive Extension Test Suite"
echo "============================================================"
echo ""

# Check if uv is available
if ! command -v uv &> /dev/null; then
    echo "ERROR: uv is not installed or not in PATH"
    exit 1
fi

# Run comprehensive tests
echo "Running comprehensive tests..."
echo ""

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

uv run python test_comprehensive.py "$@"

EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
    echo ""
    echo "============================================================"
    echo "Tests completed with failures"
    echo "============================================================"
    exit $EXIT_CODE
else
    echo ""
    echo "============================================================"
    echo "All tests passed!"
    echo "============================================================"
    exit 0
fi
