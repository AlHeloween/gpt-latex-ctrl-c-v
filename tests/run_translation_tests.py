"""
Run all translation feature tests.

Usage:
    python run_translation_tests.py
"""

import sys
from pathlib import Path

# Add parent directory to path to allow imports
sys.path.insert(0, str(Path(__file__).parent))

from test_translation import run_all_tests as run_translation_tests
from test_anchoring import run_all_tests as run_anchoring_tests
from test_translation_integration import run_all_tests as run_integration_tests


def main():
    """Run all translation tests."""
    print("\n" + "=" * 70)
    print("TRANSLATION FEATURE TEST SUITE")
    print("=" * 70 + "\n")

    results = []

    # Run translation core tests
    try:
        print("Running Translation Core Tests...")
        results.append(("Translation Core", run_translation_tests()))
    except Exception as e:
        print(f"❌ Translation core tests error: {e}")
        import traceback
        traceback.print_exc()
        results.append(("Translation Core", False))

    # Run anchoring tests
    try:
        print("\nRunning Anchoring Tests...")
        results.append(("Anchoring", run_anchoring_tests()))
    except Exception as e:
        print(f"❌ Anchoring tests error: {e}")
        import traceback
        traceback.print_exc()
        results.append(("Anchoring", False))

    # Run integration tests
    try:
        print("\nRunning Integration Tests...")
        results.append(("Translation Integration", run_integration_tests()))
    except Exception as e:
        print(f"❌ Integration tests error: {e}")
        import traceback
        traceback.print_exc()
        results.append(("Translation Integration", False))

    # Print summary
    print("\n" + "=" * 70)
    print("TEST SUMMARY")
    print("=" * 70)
    for name, passed in results:
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"{name:30s} {status}")
    print("=" * 70)

    all_passed = all(passed for _, passed in results)
    if all_passed:
        print("\n🎉 ALL TRANSLATION TESTS PASSED!")
    else:
        failed = sum(1 for _, passed in results if not passed)
        print(f"\n⚠️  {failed} test suite(s) failed")

    print("=" * 70 + "\n")

    return 0 if all_passed else 1


if __name__ == "__main__":
    sys.exit(main())

