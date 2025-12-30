"""
Real translation tests using API keys from keyring.
This Python script wraps the JavaScript test_translation_real.js and injects API keys.
"""

import subprocess
import sys
import json
from pathlib import Path

# Add AI directory to path
sys.path.insert(0, str(Path(__file__).parent / "AI"))

try:
    from api_keys import get_api_key
except ImportError:
    print("❌ Error: Could not import api_keys module")
    print("Make sure tests/AI/api_keys.py exists")
    sys.exit(1)


def get_api_keys_for_services():
    """Get API keys from keyring for translation services."""
    keys = {}
    
    # Map our service names to keyring provider names
    service_map = {
        "chatgpt": "openai",  # OpenAI API key is used for ChatGPT
        "gemini": "gemini",
        "google": None,  # Google Translate free endpoint doesn't need key
        "microsoft": None,  # Microsoft Translator free endpoint doesn't need key
        "pollinations": None,  # Pollinations doesn't need API key
        "custom": None,  # Custom API keys are configured separately
    }
    
    for service, provider in service_map.items():
        if provider:
            key = get_api_key(provider)
            if key:
                keys[service] = key
            else:
                keys[service] = ""
        else:
            keys[service] = ""
    
    return keys


def main():
    """Run translation tests with API keys from keyring."""
    print("=" * 70)
    print("REAL TRANSLATION TESTS WITH API KEYS FROM KEYRING")
    print("=" * 70)
    print()
    
    # Get API keys
    print("Retrieving API keys from keyring...")
    api_keys = get_api_keys_for_services()
    
    # Show which keys are available
    print("\nAPI Keys Status:")
    for service, key in api_keys.items():
        if key:
            masked = f"{key[:8]}...{key[-4:]}" if len(key) > 12 else "***"
            print(f"  ✅ {service:12} : Available ({masked})")
        else:
            print(f"  ⚠️  {service:12} : Not configured (will use free endpoints)")
    
    print()
    
    # Pass API keys as environment variables to Node.js script
    env = os.environ.copy()
    env["TRANSLATION_TEST_CHATGPT_KEY"] = api_keys.get("chatgpt", "")
    env["TRANSLATION_TEST_GEMINI_KEY"] = api_keys.get("gemini", "")
    
    # Run the Node.js test script
    test_script = Path(__file__).parent / "test_translation_real.js"
    
    if not test_script.exists():
        print(f"❌ Error: Test script not found: {test_script}")
        sys.exit(1)
    
    print("Running JavaScript translation tests...")
    print()
    
    result = subprocess.run(
        ["node", str(test_script)],
        env=env,
        cwd=str(Path(__file__).parent),
        capture_output=False,
        text=True
    )
    
    sys.exit(result.returncode)


if __name__ == "__main__":
    import os
    main()

