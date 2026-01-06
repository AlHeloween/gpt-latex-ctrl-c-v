#!/bin/bash
# Run fully automated tests for the extension
# Using uv package manager

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "Running unified test runner..."
echo ""
echo "Usage:"
echo "  ./run_tests.sh [--fast] [--include-large] [--headless] [--debug] [--browser chromium|firefox]"
echo ""
echo "Note: On Windows, without --fast this runs real clipboard tests and overwrites your clipboard."
echo ""

uv run python run_all.py --include-large "$@"
