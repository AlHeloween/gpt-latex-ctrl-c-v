# Automated Testing with Playwright

This repository contains automated tests for the "Copy as Office Format" extension using Python Playwright.

## Test Suites

There are two test suites available:

1. **`test_automated.py`** - Quick smoke tests for basic functionality
2. **`test_comprehensive.py`** - Comprehensive test suite verifying all 24 fixes

## Setup

### Using uv (Recommended)

If you're using `uv` package manager (Playwright already installed):

```bash
# Run the full CI-like local flow (builds wasm + runs Playwright + generates Word .docx artifacts)
./tests/run_tests.sh
```

### Generate `.docx` from `examples/*.html` (cross-platform)

This repo can generate `test_results/docx/*.docx` from the extension’s captured output for every `examples/*.html` file, using a deterministic Rust converter (no Word/COM).

```bash
uv run python tests/test_generate_docx_examples.py
```

Notes:
- Chromium must run headful for extension capture, but it is started off-screen by default (no disruptive popups).
- Inputs come only from `examples/` (no HTML fixtures under `tests/`).

Or use the convenience scripts:
- Windows: `tests/run_tests.bat`
- Linux/Mac: `tests/run_tests.sh`

### Using pip (Alternative)

If using standard pip:

```bash
pip install -r requirements.txt
playwright install firefox
python tests/test_automated.py
```

Or on Windows:
```cmd
playwright install firefox
```

## Running Tests

### Quick Tests (Smoke Tests)

**Windows:**
```cmd
uv run python tests/test_automated.py
```

**Linux/Mac:**
```bash
uv run python tests/test_automated.py
```

### Comprehensive Tests

Run all comprehensive tests:
```bash
uv run python tests/test_comprehensive.py
```

Run specific phase:
```bash
# Critical fixes only
python tests/test_comprehensive.py --phase critical

# High priority fixes only
python tests/test_comprehensive.py --phase high

# Edge cases only
python tests/test_comprehensive.py --phase edge

# Performance tests only
python tests/test_comprehensive.py --phase performance
```

With options:
```bash
# Headless mode
python tests/test_comprehensive.py --headless

# Debug output
python tests/test_comprehensive.py --debug

# Both
python tests/test_comprehensive.py --headless --debug
```

## Test Coverage

### Quick Tests (`test_automated.py`)

1. **Basic Text Selection** - Verifies plain text copying works
2. **Formula Selection** - Tests LaTeX formula conversion to OMML
3. **Multiple Formulas** - Tests handling of multiple formulas in one selection

### Comprehensive Tests (`test_comprehensive.py`)

#### Phase 1: Critical Fixes (Must Pass)
1. **Selection Loss Prevention** - Verifies selection persists during async MathJax loading
2. **CF_HTML Format Verification** - Validates UTF-16 byte offset encoding
3. **Memory Leak Prevention** - Verifies MathJax script tags are removed after loading

#### Phase 2: High Priority Fixes (Should Pass)
1. **XSS Prevention** - Tests that malicious HTML payloads are sanitized
2. **Error Handling** - Tests graceful handling of various error conditions
3. **LaTeX Edge Cases** - Tests escaped dollars, nested formulas, etc.

#### Phase 3: Edge Cases (Verify Behavior)
1. **Large Selection** - Tests performance with selections >50KB
2. **Malformed LaTeX** - Tests handling of invalid LaTeX syntax

#### Phase 4: Performance (Monitor)
1. **Multiple Copies** - Tests consecutive copy operations

## Test HTML Pages

The comprehensive test suite uses specialized test pages:

- **`gemini-conversation-test.html`** - Standard test page with formulas
- **`test_selection_loss.html`** - Tests selection persistence during async operations
- **`test_xss_payloads.html`** - Contains XSS payloads for security testing
- **`test_large_selection.html`** - Large content (>50KB) for performance testing
- **`test_edge_cases.html`** - Edge cases: escaped dollars, nested formulas, malformed LaTeX
- **`test_iframe.html`** - Cross-frame selection scenarios
- **`test_error_conditions.html`** - Various error conditions (empty selection, etc.)

## Test Limitations

### Context Menu Interaction
Playwright cannot directly interact with browser extension context menus. The test uses a workaround by:
- Injecting JavaScript to trigger the extension's message handler directly
- Simulating the context menu action programmatically

### Clipboard Verification
Due to browser security restrictions, clipboard reading is limited. The tests verify:
- Clipboard content structure (CF_HTML format)
- Presence of OMML/MathML namespaces
- HTML content structure

### Manual Verification Still Needed
For complete verification, you should still:
1. Manually test in Firefox
2. Paste into Microsoft Word
3. Verify formulas render correctly
4. Save as DOCX and reopen to verify persistence

## Test Output

The tests will output:
- ✓ for passed tests
- ✗ for failed tests
- Detailed error messages if tests fail

### Word `.docx` artifacts (optional proof)
Run `uv run python tests/test_word_examples.py` to paste examples into Word and save:
- `artifacts/word_examples/**/word_paste/pasted.docx`
- `.../document.xml` and `.../verification.json` (OMML markers)

If Microsoft Word is not installed (COM not registered), this test will print `SKIP` and exit successfully.

## Troubleshooting

### Extension Not Loading
- Ensure `manifest.json` is valid
- Check Firefox console for errors
- Verify extension path is correct

### Clipboard Read Errors
- Some browsers restrict clipboard access
- Tests may need to run in non-headless mode
- Grant clipboard permissions if prompted

### Playwright Issues
- Update Playwright: `pip install --upgrade playwright`
- Reinstall browsers: `playwright install firefox --force`

## Convenience Scripts

### Quick Tests
- **Windows:** `run_tests.bat`
- **Linux/Mac:** `./run_tests.sh`

### Comprehensive Tests
- **Windows:** `run_comprehensive_tests.bat`
- **Linux/Mac:** `./run_comprehensive_tests.sh` (make executable: `chmod +x run_comprehensive_tests.sh`)

Examples:
```bash
# Run all comprehensive tests
./run_comprehensive_tests.sh

# Run specific phase
./run_comprehensive_tests.sh --phase critical

# Run with options
./run_comprehensive_tests.sh --headless --debug
```

## Manual Testing Workflow

When automated extension loading has limitations, use the manual testing helper:

```bash
python tests/test_manual_helper.py
```

This script will:
1. Prompt you to load the extension via `about:debugging`
2. Open all test pages in Firefox
3. Provide instructions for manual verification

### Steps for Manual Testing

1. **Load Extension:**
   - Open Firefox
   - Navigate to `about:debugging`
   - Click "This Firefox"
   - Click "Load Temporary Add-on"
   - Select `extension/manifest.json`

2. **Run Test Helper:**
   ```bash
   python tests/test_manual_helper.py
   ```

3. **Test Each Page:**
   - Select text with formulas
   - Right-click → "Copy as Office Format"
   - Paste into Microsoft Word
   - Verify formulas render correctly
   - Save as DOCX and reopen

## Manual Verification Helper

For quick clipboard verification after manual testing:

```bash
python verify_clipboard.py
```

This script checks if the clipboard contains converted content (no raw LaTeX).

## Test Verification Methods

### CF_HTML Format Verification

The comprehensive test suite includes CF_HTML format verification that:
- Parses CF_HTML header
- Extracts StartHTML, EndHTML, StartFragment, EndFragment offsets
- Calculates expected UTF-16 byte lengths
- Verifies offsets match UTF-16 encoding (not UTF-8)

### Memory Leak Detection

Tests verify memory leaks are prevented by:
- Performing multiple consecutive copy operations
- Checking DOM for MathJax script tags after each operation
- Verifying script tag count remains 0 (tags removed after loading)

### Selection Loss Verification

Tests verify selection persistence by:
- Capturing selection before async operations
- Simulating MathJax loading delay
- Verifying selection remains valid
- Verifying clipboard write succeeds

### XSS Prevention Verification

Tests verify XSS prevention by:
- Copying content containing XSS payloads (`<script>`, `onerror=`, `javascript:`, etc.)
- Verifying sanitized output doesn't contain executable code
- Verifying formulas still work correctly

## Test Output

### Quick Tests

The quick tests output:
- ✓ for passed tests
- ✗ for failed tests
- Detailed error messages if tests fail

### Comprehensive Tests

The comprehensive tests provide:
- **Per-test results** with detailed verification
- **Phase summaries** (Critical, High Priority, Edge Cases, Performance)
- **Performance metrics** (execution time)
- **Failure details** with specific fix that failed
- **Overall pass/fail** with success rate

Example output:
```
============================================================
TEST SUMMARY
============================================================

Phase 1 Critical:
  Tests Run: 3
  Tests Passed: 3 ✅
  Tests Failed: 0 ❌
  Success Rate: 100.0%

Phase 2 High Priority:
  Tests Run: 3
  Tests Passed: 3 ✅
  Tests Failed: 0 ❌
  Success Rate: 100.0%

============================================================
OVERALL SUMMARY
============================================================
Total Tests Run: 6
Total Tests Passed: 6 ✅
Total Tests Failed: 0 ❌
Total Time: 15.23s
Overall Success Rate: 100.0%

🎉 ALL TESTS PASSED!
============================================================
```

## Success Criteria

- **Phase 1 (Critical)**: All tests must pass
- **Phase 2 (High Priority)**: 90%+ tests should pass
- **Phase 3 (Edge Cases)**: Should handle gracefully (no crashes)
- **Phase 4 (Performance)**: Should complete in reasonable time (<5s for large selections)

## Extending Tests

To add new tests to the comprehensive suite, modify `test_comprehensive.py`:

```python
async def test_new_feature(self):
    """Test description."""
    await self.load_test_page("test_page.html")
    
    if not await self.verify_extension_loaded():
        return False
    
    # Your test code here
    selected = await self.select_text_automatically("#selector")
    if not await self.trigger_copy_via_message():
        return False
    
    clipboard = await self.get_clipboard_content()
    # Verify results
    
    return True  # or False
```

Then add the test to `run_all_tests()` method in the appropriate phase.

## Known Limitations

1. **Extension Loading**: Firefox extensions loaded via `--load-extension` may not inject content scripts into file:// URLs. This is a known limitation of Playwright with Firefox extensions. 

   **Solutions:**
   - **Option 1**: Load extension manually via `about:debugging` and use manual testing helper
   - **Option 2**: Use `--http-server` flag to serve test pages via HTTP (may improve loading)
   - **Option 3**: Use manual testing workflow (see below)

2. **Context Menu Interaction**: Playwright cannot directly click extension context menus. The test uses workarounds to trigger the extension.

3. **Extension Marker**: The extension now exposes `window.__copyOfficeFormatExtension` marker for reliable detection, but content script must be injected first.

2. **Content Script Isolation**: Content scripts run in isolated contexts, making direct function calls difficult. The test helper provides a bridge.

3. **Clipboard Access**: Browser security may restrict clipboard reading. Tests may need to run in non-headless mode with proper permissions.

4. **Full Verification**: Automated tests verify structure and format, but visual verification in Word is still recommended for complete testing.

