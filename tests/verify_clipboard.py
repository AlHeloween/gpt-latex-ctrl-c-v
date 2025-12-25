"""
Simple clipboard verification script.
Run this after manually copying content with the extension to verify clipboard format.
"""

import pyperclip
import re
import sys


def verify_clipboard():
    """Verify clipboard content has correct Office format."""
    print("=" * 60)
    print("Clipboard Content Verification")
    print("=" * 60)
    
    try:
        # Read clipboard (this gets plain text)
        clipboard_text = pyperclip.paste()
        
        if not clipboard_text:
            print("✗ Clipboard is empty")
            return False
        
        print(f"✓ Clipboard contains {len(clipboard_text)} characters")
        print(f"  Preview: {clipboard_text[:100]}...")
        
        # Check for LaTeX formulas (should be converted, not present as raw LaTeX)
        latex_patterns = [
            r'\$[^$]+\$',  # Inline math
            r'\\\[.*?\\\]',  # Display math
            r'\\\(.*?\\\)',  # Inline math (alternative)
        ]
        
        has_raw_latex = False
        for pattern in latex_patterns:
            if re.search(pattern, clipboard_text):
                has_raw_latex = True
                print(f"⚠ Warning: Found raw LaTeX in clipboard: {pattern}")
        
        if not has_raw_latex:
            print("✓ No raw LaTeX found (formulas likely converted)")
        
        # Note: CF_HTML format is not accessible via pyperclip
        # For full verification, paste into Word and check visually
        print("\n" + "=" * 60)
        print("Next Steps:")
        print("1. Paste into Microsoft Word")
        print("2. Verify formulas appear as editable equations")
        print("3. Check formatting is preserved")
        print("4. Save as DOCX and reopen to verify persistence")
        print("=" * 60)
        
        return True
        
    except Exception as e:
        print(f"✗ Error reading clipboard: {e}")
        print("\nNote: Install pyperclip: pip install pyperclip")
        return False


if __name__ == "__main__":
    try:
        import pyperclip
    except ImportError:
        print("pyperclip not found.")
        print("Install with: uv add pyperclip")
        print("Or: pip install pyperclip")
        sys.exit(1)
    
    verify_clipboard()

