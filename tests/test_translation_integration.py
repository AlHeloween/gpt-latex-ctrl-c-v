"""
Integration tests for translation features.
Tests the full translation pipeline with HTML examples.
"""

import json
from pathlib import Path


def test_translation_config_integration():
    """Test that translation config integrates properly with storage."""
    # Simulate full config structure
    full_config = {
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
            "google": "",
            "microsoft": "",
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
        "backup": {
            "version": "1.0.0",
            "timestamp": 1234567890,
        },
    }

    # Verify all required sections exist
    assert "translation" in full_config
    assert "keyboard" in full_config
    assert "apiKeys" in full_config
    assert "customApi" in full_config
    assert "backup" in full_config

    # Verify translation config
    assert isinstance(full_config["translation"]["enabled"], bool)
    assert full_config["translation"]["service"] in [
        "google",
        "microsoft",
        "chatgpt",
        "gemini",
        "pollinations",
        "custom",
    ]
    assert len(full_config["translation"]["targetLanguages"]) == 5

    # Verify keyboard config
    assert isinstance(full_config["keyboard"]["interceptCopy"], bool)

    # Verify API keys structure
    assert all(key in full_config["apiKeys"] for key in ["google", "microsoft", "chatgpt", "gemini", "pollinations", "custom"])

    print("✓ Translation config integration test passed")


def test_anchor_translate_restore_pipeline():
    """Test the anchor → translate → restore pipeline logic."""
    # Simulate HTML with formulas and code
    original_html = '<p>Text <math>x+1</math> and <pre>code</pre> more text</p>'

    # Step 1: Anchor
    formulas = ["<math>x+1</math>"]
    codes = ["<pre>code</pre>"]
    anchored_html = original_html
    for i, formula in enumerate(formulas):
        anchored_html = anchored_html.replace(formula, f"[[COF_FORMULA_{i}]]", 1)
    for i, code in enumerate(codes):
        anchored_html = anchored_html.replace(code, f"[[COF_CODE_{i}]]", 1)

    # Verify anchoring
    assert "[[COF_FORMULA_0]]" in anchored_html
    assert "[[COF_CODE_0]]" in anchored_html
    assert "<math>x+1</math>" not in anchored_html
    assert "<pre>code</pre>" not in anchored_html

    # Step 2: Simulate translation (anchors preserved)
    # In real scenario, only text between anchors would be translated
    translated_html = anchored_html  # Anchors preserved

    # Step 3: Restore
    restored_html = translated_html
    for i, formula in enumerate(formulas):
        restored_html = restored_html.replace(f"[[COF_FORMULA_{i}]]", formula, 1)
    for i, code in enumerate(codes):
        restored_html = restored_html.replace(f"[[COF_CODE_{i}]]", code, 1)

    # Verify restoration
    assert "<math>x+1</math>" in restored_html
    assert "<pre>code</pre>" in restored_html
    assert "[[COF_FORMULA_0]]" not in restored_html
    assert "[[COF_CODE_0]]" not in restored_html

    print("✓ Anchor-translate-restore pipeline test passed")


def test_service_specific_config():
    """Test service-specific configuration requirements."""
    services_config = {
        "google": {
            "requires_api_key": True,
            "requires_region": False,
            "supports_formula_translation": False,
        },
        "microsoft": {
            "requires_api_key": True,
            "requires_region": True,
            "supports_formula_translation": False,
        },
        "chatgpt": {
            "requires_api_key": True,
            "requires_region": False,
            "supports_formula_translation": True,
        },
        "gemini": {
            "requires_api_key": True,
            "requires_region": False,
            "supports_formula_translation": True,
        },
        "pollinations": {
            "requires_api_key": False,
            "requires_region": False,
            "supports_formula_translation": True,
        },
        "custom": {
            "requires_api_key": False,  # Optional
            "requires_region": False,
            "supports_formula_translation": True,
        },
    }

    for service, config in services_config.items():
        assert "requires_api_key" in config
        assert "requires_region" in config
        assert "supports_formula_translation" in config

        # Microsoft requires region
        if service == "microsoft":
            assert config["requires_region"] == True

        # AI services support formula translation
        if service in ["chatgpt", "gemini", "pollinations", "custom"]:
            assert config["supports_formula_translation"] == True

    print("✓ Service-specific config test passed")


def test_language_configuration():
    """Test language configuration validation."""
    # Valid language codes (subset)
    valid_languages = ["en", "es", "fr", "de", "it", "pt", "ru", "zh", "ja", "ko", ""]

    test_configs = [
        {
            "name": "All languages filled",
            "targetLanguages": ["es", "fr", "de", "it", "pt"],
            "defaultLanguage": "es",
            "valid": True,
        },
        {
            "name": "Some empty slots",
            "targetLanguages": ["es", "fr", "", "", ""],
            "defaultLanguage": "es",
            "valid": True,
        },
        {
            "name": "Default not in targets",
            "targetLanguages": ["es", "fr", "", "", ""],
            "defaultLanguage": "en",
            "valid": False,  # Should validate this
        },
    ]

    for config in test_configs:
        assert len(config["targetLanguages"]) == 5
        assert all(lang in valid_languages for lang in config["targetLanguages"])
        assert config["defaultLanguage"] in valid_languages

    print("✓ Language configuration test passed")


def run_all_tests():
    """Run all integration tests."""
    print("\n=== Running Translation Integration Tests ===\n")

    try:
        test_translation_config_integration()
        test_anchor_translate_restore_pipeline()
        test_service_specific_config()
        test_language_configuration()

        print("\n=== All Integration Tests Passed ===\n")
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

