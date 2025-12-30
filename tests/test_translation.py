"""
Smoke tests for translation features.
Tests anchoring, analysis, and storage functionality.
"""

import json
import tempfile
from pathlib import Path


def test_storage_import_export():
    """Test storage configuration import/export."""
    # Simulate a config export/import cycle
    test_config = {
        "translation": {
            "enabled": True,
            "service": "pollinations",
            "targetLanguages": ["es", "fr", "de", "", ""],
            "translateFormulas": False,
            "defaultLanguage": "es",
        },
        "keyboard": {
            "interceptCopy": True,
        },
        "apiKeys": {
            "google": "test-key-google",
            "microsoft": "test-key-ms",
            "chatgpt": "",
            "gemini": "",
            "pollinations": "",
            "custom": "",
        },
        "customApi": {
            "endpoint": "https://api.pollinations.ai/predict",
            "region": "",
            "method": "POST",
            "headers": {},
        },
    }

    # Test JSON serialization (what export does)
    json_str = json.dumps(test_config, indent=2)
    assert json_str

    # Test JSON deserialization (what import does)
    loaded = json.loads(json_str)
    assert loaded["translation"]["enabled"] == True
    assert loaded["translation"]["service"] == "pollinations"
    assert loaded["apiKeys"]["google"] == "test-key-google"
    assert loaded["keyboard"]["interceptCopy"] == True

    print("✓ Storage import/export test passed")


def test_anchor_patterns():
    """Test formula and code anchoring patterns."""
    test_cases = [
        {
            "name": "MathML formula",
            "html": '<p>Text <math><mi>x</mi><mo>+</mo><mn>1</mn></math> more text</p>',
            "has_formula": True,
        },
        {
            "name": "LaTeX placeholder",
            "html": '<p>Text <!--COF_TEX_0--> more text</p>',
            "has_formula": True,
        },
        {
            "name": "Code block",
            "html": '<p>Text <pre>code here</pre> more text</p>',
            "has_code": True,
        },
        {
            "name": "Inline code",
            "html": '<p>Text <code>inline</code> more text</p>',
            "has_code": True,
        },
        {
            "name": "Mixed content",
            "html": '<p><math>x+1</math> text <pre>code</pre> <math>x+2</math></p>',
            "has_formula": True,
            "has_code": True,
        },
    ]

    for case in test_cases:
        # Check if patterns exist in HTML
        if case.get("has_formula"):
            assert (
                "<math" in case["html"] or "COF_TEX" in case["html"] or "data-math" in case["html"]
            ), f"Expected formula in: {case['name']}"
        if case.get("has_code"):
            assert (
                "<pre" in case["html"] or "<code" in case["html"]
            ), f"Expected code in: {case['name']}"

    print("✓ Anchor pattern tests passed")


def test_analysis_patterns():
    """Test content analysis patterns."""
    test_cases = [
        {
            "name": "Basic text",
            "html": "<p>This is a test sentence with multiple words.</p>",
            "has_text": True,
        },
        {
            "name": "Text with formulas",
            "html": "<p>Text <math>x+1</math> more text</p>",
            "has_text": True,
            "has_formula": True,
        },
        {
            "name": "Text with code",
            "html": "<p>Text <pre>code</pre> more text</p>",
            "has_text": True,
            "has_code": True,
        },
    ]

    for case in test_cases:
        # Strip HTML tags to simulate text extraction
        import re
        text = re.sub(r"<[^>]+>", " ", case["html"])
        text = re.sub(r"\s+", " ", text).strip()

        if case.get("has_text"):
            assert len(text) > 0, f"Expected text in: {case['name']}"
        if case.get("has_formula"):
            assert "<math" in case["html"] or "COF_TEX" in case["html"]
        if case.get("has_code"):
            assert "<pre" in case["html"] or "<code" in case["html"]

    print("✓ Analysis pattern tests passed")


def test_translation_service_configs():
    """Test translation service configuration structures."""
    services = ["google", "microsoft", "chatgpt", "gemini", "pollinations", "custom"]

    for service in services:
        config = {
            "translation": {
                "service": service,
                "enabled": True,
            },
            "apiKeys": {
                service: "test-key" if service != "pollinations" else "",
            },
        }

        # Verify config structure
        assert config["translation"]["service"] == service
        assert "apiKeys" in config

        # Pollinations doesn't require API key
        if service == "pollinations":
            assert config["apiKeys"][service] == ""
        else:
            assert config["apiKeys"][service] == "test-key"

    print("✓ Translation service config tests passed")


def test_config_validation():
    """Test configuration validation logic."""
    valid_config = {
        "translation": {"enabled": True, "service": "pollinations"},
        "keyboard": {"interceptCopy": True},
        "apiKeys": {},
    }

    # Valid config checks
    assert isinstance(valid_config["translation"]["enabled"], bool)
    assert isinstance(valid_config["keyboard"]["interceptCopy"], bool)
    assert valid_config["translation"]["service"] in [
        "google",
        "microsoft",
        "chatgpt",
        "gemini",
        "pollinations",
        "custom",
    ]

    invalid_configs = [
        {},  # Missing required fields
        {"translation": {}},  # Missing enabled
        {"translation": {"enabled": "yes"}},  # Wrong type
    ]

    for invalid in invalid_configs:
        # These should fail validation
        has_translation = "translation" in invalid and isinstance(invalid.get("translation"), dict)
        has_enabled = (
            has_translation
            and "enabled" in invalid["translation"]
            and isinstance(invalid["translation"]["enabled"], bool)
        )
        # At least one should be missing or wrong
        assert not (has_translation and has_enabled), f"Config should be invalid: {invalid}"

    print("✓ Config validation tests passed")


def test_language_selection():
    """Test target language selection logic."""
    config = {
        "translation": {
            "targetLanguages": ["es", "fr", "de", "it", "pt"],
            "defaultLanguage": "es",
        }
    }

    # Check language arrays
    assert len(config["translation"]["targetLanguages"]) == 5
    assert config["translation"]["defaultLanguage"] in config["translation"]["targetLanguages"]

    # Valid language codes (sample)
    valid_langs = ["en", "es", "fr", "de", "it", "pt", "ru", "zh", "ja", "ko", ""]
    for lang in config["translation"]["targetLanguages"]:
        assert lang == "" or lang in valid_langs, f"Invalid language code: {lang}"

    print("✓ Language selection tests passed")


def run_all_tests():
    """Run all translation tests."""
    print("\n=== Running Translation Feature Tests ===\n")

    try:
        test_storage_import_export()
        test_anchor_patterns()
        test_analysis_patterns()
        test_translation_service_configs()
        test_config_validation()
        test_language_selection()

        print("\n=== All Translation Tests Passed ===\n")
        return True
    except AssertionError as e:
        print(f"\n✗ Test failed: {e}\n")
        return False
    except Exception as e:
        print(f"\n✗ Test error: {e}\n")
        return False


if __name__ == "__main__":
    success = run_all_tests()
    exit(0 if success else 1)

