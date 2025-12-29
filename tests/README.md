# Tests

Primary test docs live in `docs/testing/README.md`.

Quick commands:

- `uv run python tests/test_automated.py` - fully automated Chromium extension tests.
- `uv run python tests/test_word_examples.py` - scans `examples/*.html` and verifies Word paste (skips if Word is unavailable; only keeps artifacts on failure unless `--out-root` is provided).
