# Quick Start Guide - Comprehensive Tests

## Running Comprehensive Tests

### Windows
```cmd
cd tests
run_comprehensive_tests.bat
```

### Linux/Mac
```bash
cd tests
chmod +x run_comprehensive_tests.sh
./run_comprehensive_tests.sh
```

### Direct Python
```bash
uv run python tests/test_comprehensive.py
```

## Test Phases

Run specific phases to focus on particular fixes:

```bash
# Critical fixes only (3 tests)
uv run python tests/test_comprehensive.py --phase critical

# High priority fixes only (5 tests)
uv run python tests/test_comprehensive.py --phase high

# Edge cases only (2 tests)
uv run python tests/test_comprehensive.py --phase edge

# Performance tests only (2 tests)
uv run python tests/test_comprehensive.py --phase performance
```

## Options

```bash
# Headless mode (no browser window)
uv run python tests/test_comprehensive.py --headless

# Debug output (verbose logging)
uv run python tests/test_comprehensive.py --debug

# Combine options
uv run python tests/test_comprehensive.py --headless --debug --phase critical
```

## What Gets Tested

### Phase 1: Critical Fixes (Must Pass)
- ✅ Selection loss prevention
- ✅ CF_HTML format (UTF-16 encoding)
- ✅ Memory leak prevention

### Phase 2: High Priority (Should Pass)
- ✅ XSS prevention
- ✅ Error handling
- ✅ Context menu reload
- ✅ LaTeX edge cases
- ✅ Cache limits

### Phase 3: Edge Cases (Verify Behavior)
- ✅ Large selections (>50KB)
- ✅ Malformed LaTeX
- ✅ Cross-frame selections (iframes)
- ✅ MathJax loading failures

### Phase 4: Performance (Monitor)
- ✅ Multiple copies
- ✅ Cache behavior

## Expected Results

- **Phase 1**: All 3 tests should pass
- **Phase 2**: 4-5 out of 5 tests should pass
- **Phase 3**: Should handle gracefully (no crashes) - 4 tests
- **Phase 4**: Should complete in reasonable time

## Troubleshooting

### Extension Not Loading
- Ensure `extension/manifest.json` is valid
- Check Firefox console for errors
- Verify extension path is correct

### Clipboard Read Errors
- Some browsers restrict clipboard access
- Tests may show `NotAllowedError` (expected in some environments)
- Try running in non-headless mode

### Tests Taking Too Long
- Large selection test may take 5-10 seconds
- This is expected for >50KB content
- Check debug output for details

## Next Steps

After tests pass:
1. Manually test in Firefox
2. Paste into Microsoft Word
3. Verify formulas render correctly
4. Save as DOCX and reopen

For more details, see `TEST_SUITE_SUMMARY.md` and `README_TESTING.md`.

