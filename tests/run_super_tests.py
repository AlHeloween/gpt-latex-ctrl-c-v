"""
Super Extension Testing - Comprehensive Test Runner

This script runs all tests and provides detailed results.
For best results, load extension manually via about:debugging first.
"""

import asyncio
import sys
from pathlib import Path

# Add project root to path
PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

# Import from test_comprehensive module
import importlib.util
spec = importlib.util.spec_from_file_location("test_comprehensive", PROJECT_ROOT / "tests" / "test_comprehensive.py")
test_comprehensive = importlib.util.module_from_spec(spec)
spec.loader.exec_module(test_comprehensive)

ComprehensiveExtensionTester = test_comprehensive.ComprehensiveExtensionTester
EXTENSION_PATH = test_comprehensive.EXTENSION_PATH

async def run_super_tests():
    """Run comprehensive test suite."""
    print("="*70)
    print("SUPER EXTENSION TESTING SUITE")
    print("="*70)
    print("\n📋 Test Configuration:")
    print("   - All phases")
    print("   - Non-headless (visible browser)")
    print("   - Debug output enabled")
    print("\n⚠️  IMPORTANT:")
    print("   For best results, load extension manually first:")
    print("   1. Open Firefox")
    print("   2. Navigate to about:debugging")
    print("   3. Click 'This Firefox'")
    print("   4. Click 'Load Temporary Add-on'")
    print("   5. Select manifest.json")
    print("\n   Then press Enter to continue with tests...")
    print("   (Or Ctrl+C to cancel)")
    
    try:
        input()
    except (KeyboardInterrupt, EOFError):
        print("\n⚠️  Continuing anyway - extension may not be loaded")
        print("   Tests will fail if extension is not loaded\n")
    
    print("\n🚀 Starting comprehensive test suite...\n")
    
    # Create tester with all options enabled
    tester = ComprehensiveExtensionTester(
        EXTENSION_PATH,
        headless=False,  # Visible browser
        debug=True,      # Verbose output
        use_http_server=False,  # Use file:// URLs
        use_addonmanager=False  # Don't try automated loading
    )
    
    try:
        # Run all tests
        await tester.run_all_tests(phase_filter=None)  # All phases
        
        # Print final summary
        print("\n" + "="*70)
        print("TEST EXECUTION COMPLETE")
        print("="*70)
        
        # Get stats from tester (it's called results in the class)
        stats = getattr(tester, 'results', {})
        
        total_run = sum(phase.get("run", 0) for phase in stats.values())
        total_passed = sum(phase.get("passed", 0) for phase in stats.values())
        total_failed = sum(phase.get("failed", 0) for phase in stats.values())
        
        print(f"\n📊 Overall Results:")
        print(f"   Tests Run: {total_run}")
        print(f"   ✅ Passed: {total_passed}")
        print(f"   ❌ Failed: {total_failed}")
        
        if total_run > 0:
            success_rate = (total_passed / total_run) * 100
            print(f"   Success Rate: {success_rate:.1f}%")
        
        # Phase breakdown
        if stats:
            print(f"\n📋 Phase Breakdown:")
            for phase_name, phase_stats in stats.items():
                if phase_stats.get("run", 0) > 0:
                    phase_display = phase_name.replace("_", " ").title()
                    print(f"   {phase_display}:")
                    print(f"      Run: {phase_stats.get('run', 0)}, Passed: {phase_stats.get('passed', 0)}, Failed: {phase_stats.get('failed', 0)}")
        
        # Recommendations
        print(f"\n💡 Recommendations:")
        if total_failed > 0:
            print("   - Check if extension is loaded (about:debugging)")
            print("   - Verify extension marker: window.__copyOfficeFormatExtension")
            print("   - Check browser console for errors")
            print("   - Try manual testing workflow")
        else:
            print("   - All tests passed! 🎉")
            print("   - Verify in Microsoft Word")
            print("   - Test with real content")
        
    except Exception as e:
        print(f"\n❌ Test suite error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        await tester.cleanup()

if __name__ == "__main__":
    try:
        asyncio.run(run_super_tests())
    except KeyboardInterrupt:
        print("\n\n⚠️  Tests interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Fatal error: {e}")
        sys.exit(1)

