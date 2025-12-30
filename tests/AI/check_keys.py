# -*- coding: utf-8 -*-
"""Quick script to check if API keys are stored and retrievable."""

import sys
from pathlib import Path

project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

try:
    import keyring
    version = getattr(keyring, '__version__', 'unknown')
    print(f"✅ keyring module available: {version}")
    try:
        backend = keyring.get_keyring()
        print(f"   Backend: {type(backend).__name__}")
    except Exception as e:
        print(f"   Backend error: {e}")
except ImportError as e:
    print(f"❌ keyring module not available: {e}")
    print("\nTo install keyring:")
    print("  uv pip install keyring")
    print("  or")
    print("  pip install keyring")
    sys.exit(1)

from api_keys import get_api_key, SERVICE_NAME

print(f"SERVICE_NAME: {SERVICE_NAME}")
print("\n" + "="*60)
print("Checking stored API keys:")
print("="*60)

providers = ['openai', 'gemini', 'grok', 'deepseek']

for provider in providers:
    key = get_api_key(provider)
    if key:
        # Show first 8 chars and last 4 chars for security
        masked = f"{key[:8]}...{key[-4:]}" if len(key) > 12 else "***"
        print(f"✅ {provider:10} : KEY FOUND ({masked})")
    else:
        print(f"❌ {provider:10} : NO KEY")

print("\n" + "="*60)
print("Testing direct keyring access:")
print("="*60)

try:
    for provider in providers:
        try:
            key = keyring.get_password(SERVICE_NAME, provider)
            if key:
                masked = f"{key[:8]}...{key[-4:]}" if len(key) > 12 else "***"
                print(f"✅ {provider:10} : Found in keyring ({masked})")
            else:
                print(f"❌ {provider:10} : Not in keyring")
        except Exception as e:
            print(f"⚠️ {provider:10} : Error accessing keyring: {e}")
except Exception as e:
    print(f"❌ Error accessing keyring: {e}")

