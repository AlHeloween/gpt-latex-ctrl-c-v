# Tests

Primary test docs live in `docs/testing/README.md`.

Quick commands:

- `uv run python tests/test_automated.py` - fully automated Chromium extension tests.
- `uv run python tests/test_word_examples.py` - scans `examples/*.html` and verifies Word paste (skips if Word is unavailable; only keeps artifacts on failure unless `--out-root` is provided).
- `uv run python tests/run_translation_tests.py` - run all translation feature tests (anchoring, storage, translation services, integration).
- `node tests/test_translation_real.js` - run real translation tests (tests actual JavaScript modules with real API calls).

## Translation Feature Tests

The extension includes comprehensive tests for translation features:

- **`test_translation.py`** - Core translation functionality tests:
  - Storage import/export
  - Configuration validation
  - Translation service configurations
  - Language selection

- **`test_anchoring.py`** - Formula and code anchoring tests:
  - Formula pattern detection (MathML, LaTeX, data-math, OMML)
  - Code pattern detection (pre, code blocks)
  - Anchor restoration logic
  - Formula translation service restrictions

- **`test_translation_integration.py`** - Integration tests:
  - Full config integration
  - Anchor → translate → restore pipeline
  - Service-specific configuration
  - Language configuration validation

Run all translation tests:
```bash
uv run python tests/run_translation_tests.py
```

Or run individual test files:
```bash
uv run python tests/test_translation.py
uv run python tests/test_anchoring.py
uv run python tests/test_translation_integration.py
```

## Real Translation Tests

**`test_translation_real.js`** - Real tests that actually execute JavaScript modules:
- Tests actual anchoring module with real HTML
- Tests actual analysis module with real content
- Tests Google Translate free endpoint (real API call - no API key needed)
- Tests Pollinations API (real API call)
- Tests full translation pipeline

**Run real tests:**

Without API keys (free services only):
```bash
node tests/test_translation_real.js
```

With API keys from keyring (tests ChatGPT, Gemini, etc.):
```bash
python tests/test_translation_real_with_keys.py
```

Or manually set environment variables:
```bash
TRANSLATION_TEST_CHATGPT_KEY=your_key TRANSLATION_TEST_GEMINI_KEY=your_key node tests/test_translation_real.js
```

These tests:
- Load and execute the actual JavaScript modules (`cof-anchor.js`, `cof-analysis.js`, `cof-translate.js`)
- Make real API calls to translation services
- Test actual functionality, not just structure
- Use API keys from OS keyring when available (via Python wrapper)
