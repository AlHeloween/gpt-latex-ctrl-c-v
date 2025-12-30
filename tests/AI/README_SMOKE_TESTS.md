# Smoke Tests for AI Image Generation

## Purpose

These smoke tests verify that image generation APIs actually work with real API keys.

## Prerequisites

1. **Install keyring** (if not already installed):
   ```bash
   uv pip install keyring
   # or
   pip install keyring
   ```

2. **Ensure API keys are stored** in keyring:
   - Keys should have been stored using `site_link_cli.config.api_keys.set_api_key()`
   - Use the `tools/store_api_keys.py` script to store keys from a file

## Running Smoke Tests

### Check if keys are available:
```bash
python tests/ai/check_keys.py
```

### Run image generation smoke tests:
```bash
python -m tests.ai.smoke_test_image_generation
```

### Run pytest-based tests:
```bash
pytest tests/ai/test_ai_clients.py::TestOpenAIClient::test_image_generation -v -s
pytest tests/ai/test_ai_clients.py::TestGrokClient::test_image_generation -v -s
pytest tests/ai/test_ai_clients.py::TestGeminiClient::test_image_generation_not_supported -v -s
```

## What the tests verify:

1. **OpenAI (DALL-E)**: Should generate actual images ✅
2. **Grok**: Tests if image generation actually works or returns None ❓
3. **Gemini**: Should correctly return None (doesn't support image generation) ✅

## Expected Results:

- **OpenAI**: ✅ Should generate valid image bytes
- **Grok**: ⚠️ Unknown - test will verify if it works or returns None
- **Gemini**: ✅ Should return None (not supported)

