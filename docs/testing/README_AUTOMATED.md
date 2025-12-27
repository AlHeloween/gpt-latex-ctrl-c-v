# Fully Automated Test Suite

## Overview

The automated test suite (`test_automated.py`) runs **100% automatically** with no manual intervention required.

## What It Tests

1. **Extension Loading** - Verifies extension is loaded and content script is active
2. **Basic Text Selection** - Tests copying plain text without formulas
3. **LaTeX Formula Conversion** - Tests copying text with LaTeX formulas
4. **Multiple Messages** - Tests copying multiple message blocks
5. **Clipboard Verification** - Verifies clipboard contains:
   - HTML content
   - OMML/MathML namespaces (for formulas)
   - CF_HTML format
   - No raw LaTeX (formulas converted)

## Running the Tests

### Quick Start

**Windows:**
```cmd
tests\run_tests.bat
```

**Linux/Mac:**
```bash
chmod +x tests/run_tests.sh
./tests/run_tests.sh
```

### Direct Execution

```bash
# Normal mode (visible browser)
uv run python tests/test_automated.py

# Headless mode (no browser window)
uv run python tests/test_automated.py --headless

# Debug mode (verbose output)
uv run python tests/test_automated.py --debug

# Both
uv run python tests/test_automated.py --headless --debug
```

`tests/run_tests.*` is the recommended entry point: it builds the WASM converter and runs the Playwright suite.

### Command Line Options

- `--headless` - Run Firefox in headless mode (no visible window)
- `--debug` - Enable verbose debug output showing all operations

## Test Output

The test suite provides:
- ✅ Pass/fail status for each test
- Detailed verification of clipboard content
- Summary with success rate
- Error messages if tests fail

### Example Output

```
============================================================
FULLY AUTOMATED EXTENSION TEST SUITE
============================================================
Setting up Firefox with extension...
✓ Firefox launched with extension
Loading test page...
✓ Test page loaded
Verifying extension is loaded...
✓ Extension content script is active

============================================================
TEST: Basic Text Selection
============================================================
Selecting text from: user-query-content:first-of-type
✓ Selected 45 characters
Triggering copy function...
✓ Copy message sent successfully
Verifying clipboard content...
✓ Clipboard contains HTML (1234 chars)
✓ Clipboard has CF_HTML format
✓ No raw LaTeX found

✅ TEST PASSED: Basic Text Selection

============================================================
TEST SUMMARY
============================================================
Tests Run: 3
Tests Passed: 3 ✅
Tests Failed: 0 ❌

Success Rate: 100.0%

🎉 ALL TESTS PASSED!
============================================================
```

## Test Configuration

### Wait Times

The test uses **0.5 second maximum waits** for all operations:
- If an operation doesn't complete in 0.5 seconds, it means the commands are wrong
- Extension loading check: 0.5 seconds max
- Element selection: 0.5 seconds max  
- Copy operation: 0.5 seconds max

This ensures fast feedback - if something doesn't work quickly, there's a setup issue.

## Exit Codes

- `0` - All tests passed
- `1` - One or more tests failed

Useful for CI/CD integration:
```bash
python tests/test_automated.py && echo "Tests passed" || echo "Tests failed"
```

## Troubleshooting

### Extension Not Loading

If tests fail with "Extension content script not found":
1. Check `manifest.json` is valid
2. Verify extension path is correct
3. Check Firefox console for errors

### Clipboard Read Errors

If clipboard verification fails:
- Tests will still run but mark clipboard checks as warnings
- This is expected in some environments
- Manual verification in Word is still recommended

### Timeout Issues

If tests timeout:
- Increase wait times in the code
- Check if MathJax is loading (may take longer on first run)
- Verify network connectivity (for MathJax CDN if used)

## Integration with CI/CD

Example GitHub Actions workflow:

```yaml
name: Test Extension

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-python@v2
      - run: pip install playwright
      - run: playwright install firefox
      - run: python tests/test_automated.py
```

## Next Steps

After automated tests pass:
1. Manual verification in Microsoft Word (paste and check formulas)
2. Test on different websites
3. Test with various LaTeX formula types

