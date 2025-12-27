# UV Setup for Testing

This project uses `uv` for Python package management. Playwright with Firefox is already installed.

## Quick Start

Simply run the tests:

```bash
python tests/test_extension.py
```

Or use the convenience script:

**Windows:**
```cmd
tests\run_tests.bat
```

**Linux/Mac:**
```bash
chmod +x tests/run_tests.sh
./tests/run_tests.sh
```

## Dependencies

The test suite requires:
- `playwright` - Already installed via uv
- `pyperclip` - Optional, for clipboard verification

If you need to add `pyperclip`:

```bash
uv add pyperclip
```

## Running Tests

The test script will:
1. Launch Firefox with the extension loaded
2. Open the test HTML file
3. Select text with formulas
4. Trigger the extension's copy function
5. Verify clipboard content format

## Notes

- `python.exe` is mapped to the current uv venv
- Playwright Firefox browser is already installed
- Tests run in non-headless mode by default (set `headless=False` in test_extension.py)
- For CI/CD, you may want to set `headless=True`

