# UV Setup for Testing

This repo uses `uv` for Python package management.

## Setup

```bash
uv sync
uv run playwright install chromium
```

## Run Tests

Use the convenience runner:

- Windows: `tests\\run_tests.bat`
- Linux/Mac: `./tests/run_tests.sh`

Or run directly:

```bash
uv run python tests/test_automated.py --browser chromium
```

## Optional Dependencies

- `pyperclip` is optional for local clipboard inspection helpers.
