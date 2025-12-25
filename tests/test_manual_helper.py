"""
Manual Testing Helper for Copy as Office Format Extension

This script helps with manual testing workflow when automated extension loading
has limitations. It opens test pages in Firefox after the extension is loaded.

Usage:
    1. Load extension manually via about:debugging
    2. Run this script to open test pages
    3. Manually verify extension functionality
"""

import webbrowser
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
TESTS_DIR = PROJECT_ROOT / "tests"

TEST_PAGES = [
    "gemini-conversation-test.html",
    "test_selection_loss.html",
    "test_xss_payloads.html",
    "test_large_selection.html",
    "test_edge_cases.html",
    "test_iframe.html",
    "test_error_conditions.html",
    "debug-extension.html"
]

def open_test_pages():
    """Open all test pages in Firefox."""
    print("="*60)
    print("Manual Testing Helper")
    print("="*60)
    print("\nIMPORTANT: Load the extension first via about:debugging")
    print("1. Open Firefox")
    print("2. Navigate to about:debugging")
    print("3. Click 'This Firefox'")
    print("4. Click 'Load Temporary Add-on'")
    print("5. Select manifest.json from extension directory")
    print("\nPress Enter after loading the extension...")
    input()
    
    print("\nOpening test pages...")
    for i, page in enumerate(TEST_PAGES, 1):
        page_path = TESTS_DIR / page
        if page_path.exists():
            file_url = f"file://{page_path.absolute()}"
            print(f"{i}. Opening {page}...")
            webbrowser.open(file_url)
        else:
            print(f"{i}. ⚠ {page} not found")
    
    print("\n" + "="*60)
    print("Test pages opened!")
    print("="*60)
    print("\nInstructions:")
    print("1. Select text on each page")
    print("2. Right-click and choose 'Copy as Office Format'")
    print("3. Paste into Microsoft Word")
    print("4. Verify formulas render correctly")
    print("5. Save as DOCX and reopen to verify persistence")
    print("\nUse debug-extension.html for interactive testing and status checks.")

if __name__ == "__main__":
    try:
        open_test_pages()
    except KeyboardInterrupt:
        print("\n\nCancelled by user")
        sys.exit(0)
    except Exception as e:
        print(f"\nError: {e}")
        sys.exit(1)

