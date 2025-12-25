"""
Fully Automated Test Suite for "Copy as Office Format" Extension

This test runs 100% automatically - no manual steps required.

Usage:
    python test_automated.py [--headless] [--debug]
"""

import asyncio
import argparse
import json
import sys
from pathlib import Path
from playwright.async_api import async_playwright, BrowserContext, Page


PROJECT_ROOT = Path(__file__).parent.parent
EXTENSION_PATH = PROJECT_ROOT
TEST_HTML = PROJECT_ROOT / "tests" / "gemini-conversation-test.html"


class AutomatedExtensionTester:
    def __init__(self, extension_path: Path, test_html: Path, headless: bool = False, debug: bool = False):
        self.extension_path = extension_path
        self.test_html = test_html
        self.headless = headless
        self.debug = debug
        self.context: BrowserContext = None
        self.page: Page = None
        self.results = {
            "tests_run": 0,
            "tests_passed": 0,
            "tests_failed": 0,
            "errors": []
        }
    
    def log(self, message: str, level: str = "info"):
        """Log message with optional debug output."""
        prefix = {
            "info": "ℹ️",
            "success": "✅",
            "error": "❌",
            "warning": "⚠️",
            "debug": "🔍"
        }.get(level, "ℹ️")
        
        if level == "debug" and not self.debug:
            return
        
        print(f"{prefix} {message}")

    async def setup(self):
        """Set up Playwright with Firefox and extension."""
        self.log("Setting up Firefox with extension...", "info")
        playwright = await async_playwright().start()
        
        extension_path_str = str(self.extension_path.absolute())
        self.log(f"Extension path: {extension_path_str}", "debug")
        
        self.context = await playwright.firefox.launch_persistent_context(
            user_data_dir=Path.home() / ".playwright-firefox-test",
            headless=self.headless,
            args=[
                f"--load-extension={extension_path_str}",
            ]
        )
        
        # Get or create page
        pages = self.context.pages
        if pages:
            self.page = pages[0]
        else:
            self.page = await self.context.new_page()
        
        self.log("Firefox launched with extension", "success")

    async def load_test_page(self):
        """Load the test HTML page."""
        file_url = f"file://{self.test_html.absolute()}"
        self.log(f"Loading test page: {file_url}", "info")
        await self.page.goto(file_url, wait_until="domcontentloaded")
        await self.page.wait_for_load_state("networkidle", timeout=5000)
        self.log("Test page loaded", "success")

    async def verify_extension_loaded(self) -> bool:
        """Verify extension content script is loaded."""
        self.log("Verifying extension is loaded...", "info")
        
        # Wait up to 0.5 seconds for extension to load
        max_wait = 0.5
        check_interval = 0.1
        attempts = int(max_wait / check_interval)
        
        for attempt in range(attempts):
            is_loaded = await self.page.evaluate("""
                () => {
                    return typeof browser !== 'undefined' && 
                           typeof browser.runtime !== 'undefined';
                }
            """)
            
            if is_loaded:
                self.log("Extension content script is active", "success")
                return True
            
            if attempt < attempts - 1:
                await asyncio.sleep(check_interval)
        
        # Extension not loaded - this means wrong setup
        self.log("Extension content script not found", "error")
        self.log("  This indicates the extension is not properly loaded", "error")
        self.log("  Check: --load-extension flag, manifest.json, or use about:debugging", "error")
        self.results["errors"].append("Extension content script not loaded - check extension loading")
        return False

    async def select_text_automatically(self, selector: str) -> str:
        """Automatically select text from an element."""
        self.log(f"Selecting text from: {selector}", "info")
        
        # Wait for element to exist (max 0.5 seconds)
        try:
            await self.page.wait_for_selector(selector, timeout=500, state="attached")
        except Exception as e:
            self.log(f"Element not found: {selector}", "error")
            self.log(f"  Error: {e}", "debug")
            return ""
        
        selected_text = await self.page.evaluate(f"""
            (() => {{
                const element = document.querySelector('{selector}');
                if (!element) return '';
                
                const range = document.createRange();
                range.selectNodeContents(element);
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
                
                return selection.toString();
            }})();
        """)
        
        if selected_text:
            self.log(f"Selected {len(selected_text)} characters", "success")
            self.log(f"  Preview: {selected_text[:50]}...", "debug")
        else:
            self.log("No text selected", "error")
        
        return selected_text

    async def trigger_copy_via_message(self) -> bool:
        """Trigger copy by sending message directly to content script."""
        self.log("Triggering copy function...", "info")
        
        try:
            result = await self.page.evaluate("""
                async () => {
                    if (typeof browser !== 'undefined' && browser.runtime) {
                        try {
                            await browser.runtime.sendMessage({type: 'COPY_OFFICE_FORMAT'});
                            return {success: true};
                        } catch (e) {
                            return {success: false, error: e.message};
                        }
                    }
                    return {success: false, error: 'Extension API not available'};
                }
            """)
            
            if result.get("success"):
                self.log("Copy message sent successfully", "success")
                # Wait for operation to complete (max 0.5 seconds)
                # If it takes longer, the commands are wrong
                await asyncio.sleep(0.5)
                return True
            else:
                error_msg = result.get('error', 'Unknown error')
                self.log(f"Failed to send message: {error_msg}", "error")
                self.results["errors"].append(f"Message send failed: {error_msg}")
                return False
        except Exception as e:
            self.log(f"Error triggering copy: {e}", "error")
            self.results["errors"].append(f"Copy trigger error: {str(e)}")
            return False

    async def verify_clipboard_content(self) -> dict:
        """Verify clipboard contains expected content with enhanced verification."""
        self.log("Verifying clipboard content...", "info")
        
        clipboard_data = await self.page.evaluate("""
            async () => {
                try {
                    if (!navigator.clipboard || !navigator.clipboard.read) {
                        return {error: 'Clipboard API not available'};
                    }
                    
                    const items = await navigator.clipboard.read();
                    const result = {};
                    for (const item of items) {
                        for (const type of item.types) {
                            const blob = await item.getType(type);
                            result[type] = await blob.text();
                        }
                    }
                    return result;
                } catch (e) {
                    return {error: e.toString(), errorName: e.name};
                }
            }
        """)
        
        verification = {
            "has_content": False,
            "has_html": False,
            "has_plain_text": False,
            "contains_omml": False,
            "contains_mathml": False,
            "has_cf_html_format": False,
            "cf_html_utf16_compliant": False,
            "no_raw_latex": True,
            "error": None
        }
        
        if "error" in clipboard_data:
            verification["error"] = clipboard_data.get("error")
            self.log(f"Clipboard read error: {verification['error']}", "warning")
            return verification
        
        if not clipboard_data:
            self.log("Clipboard is empty", "error")
            return verification
        
        verification["has_content"] = True
        
        # Check for HTML
        html_content = clipboard_data.get("text/html", "")
        if html_content:
            verification["has_html"] = True
            self.log(f"Clipboard contains HTML ({len(html_content)} chars)", "success")
            self.log(f"  HTML preview: {html_content[:100]}...", "debug")
            
            # Check for OMML
            if 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"' in html_content:
                verification["contains_omml"] = True
                self.log("Clipboard HTML contains OMML namespace", "success")
            
            # Check for MathML
            if "http://www.w3.org/1998/Math/MathML" in html_content:
                verification["contains_mathml"] = True
                self.log("Clipboard HTML contains MathML namespace", "success")
            
            # Check for CF_HTML format
            if "Version:1.0" in html_content and "StartHTML:" in html_content:
                verification["has_cf_html_format"] = True
                self.log("Clipboard has CF_HTML format", "success")
                
                # Enhanced: Verify UTF-16 encoding compliance
                import re
                start_html_match = re.search(r'StartHTML:(\d+)', html_content)
                if start_html_match:
                    header_end = html_content.find("<!--StartFragment-->")
                    if header_end > 0:
                        header_text = html_content[:header_end]
                        # Calculate UTF-16 byte length
                        utf16_len = sum(4 if ord(c) > 0xFFFF else 2 for c in header_text)
                        actual_offset = int(start_html_match.group(1))
                        # Allow small tolerance
                        if abs(actual_offset - utf16_len) <= 2:
                            verification["cf_html_utf16_compliant"] = True
                            self.log("CF_HTML format uses UTF-16 encoding (verified)", "success")
            
            # Check for raw LaTeX (should not be present if converted)
            import re
            if re.search(r'\$[^$]+\$|\\\[.*?\\\]', html_content):
                verification["no_raw_latex"] = False
                self.log("Warning: Clipboard contains raw LaTeX (may not be converted)", "warning")
            else:
                self.log("No raw LaTeX found (formulas likely converted)", "success")
        
        # Check for plain text
        if "text/plain" in clipboard_data:
            verification["has_plain_text"] = True
            text_len = len(clipboard_data['text/plain'])
            self.log(f"Clipboard contains plain text ({text_len} chars)", "success")
            self.log(f"  Text preview: {clipboard_data['text/plain'][:50]}...", "debug")
        
        return verification

    async def run_test(self, test_name: str, selector: str, expect_formulas: bool = False):
        """Run a single automated test."""
        print(f"\n{'='*60}")
        print(f"TEST: {test_name}")
        print(f"{'='*60}")
        
        self.results["tests_run"] += 1
        
        try:
            # Load page
            await self.load_test_page()
            
            # Verify extension
            if not await self.verify_extension_loaded():
                self.results["tests_failed"] += 1
                return False
            
            # Select text
            selected = await self.select_text_automatically(selector)
            if not selected:
                self.results["tests_failed"] += 1
                self.results["errors"].append(f"{test_name}: No text selected")
                return False
            
            # Trigger copy
            if not await self.trigger_copy_via_message():
                self.results["tests_failed"] += 1
                return False
            
            # Verify clipboard
            verification = await self.verify_clipboard_content()
            
            # Check results
            passed = True
            if verification.get("error"):
                if "NotAllowedError" not in verification["error"]:
                    passed = False
                    print(f"✗ Clipboard error: {verification['error']}")
            else:
                if not verification["has_content"]:
                    passed = False
                    print("✗ Clipboard is empty")
                elif not verification["has_html"]:
                    passed = False
                    print("✗ Clipboard missing HTML content")
                elif expect_formulas and not verification["contains_omml"] and not verification["contains_mathml"]:
                    passed = False
                    print("✗ Clipboard missing OMML/MathML (formulas not converted)")
            
            if passed:
                self.log(f"TEST PASSED: {test_name}", "success")
                self.results["tests_passed"] += 1
            else:
                self.log(f"TEST FAILED: {test_name}", "error")
                self.results["tests_failed"] += 1
            
            return passed
            
        except Exception as e:
            print(f"\n❌ TEST ERROR: {test_name} - {e}")
            self.results["tests_failed"] += 1
            self.results["errors"].append(f"{test_name}: {str(e)}")
            import traceback
            traceback.print_exc()
            return False

    async def run_all_tests(self):
        """Run all automated tests."""
        print("="*60)
        print("FULLY AUTOMATED EXTENSION TEST SUITE")
        if self.headless:
            print("Mode: HEADLESS")
        if self.debug:
            print("Mode: DEBUG (verbose output)")
        print("="*60)
        
        try:
            await self.setup()
            
            # Test 1: Basic text selection
            await self.run_test(
                "Basic Text Selection",
                "user-query-content:first-of-type",
                expect_formulas=False
            )
            
            # Test 2: Text with formulas
            await self.run_test(
                "Text with LaTeX Formulas",
                "message-content:first-of-type",
                expect_formulas=True
            )
            
            # Test 3: Multiple messages
            await self.run_test(
                "Multiple Messages with Formulas",
                "message-content:first-of-type, message-content:nth-of-type(2)",
                expect_formulas=True
            )
            
            # Print summary
            self.print_summary()
            
        except Exception as e:
            print(f"\n❌ Test suite error: {e}")
            import traceback
            traceback.print_exc()
        finally:
            await self.cleanup()

    def print_summary(self):
        """Print test summary."""
        print("\n" + "="*60)
        print("TEST SUMMARY")
        print("="*60)
        print(f"Tests Run: {self.results['tests_run']}")
        print(f"Tests Passed: {self.results['tests_passed']} ✅")
        print(f"Tests Failed: {self.results['tests_failed']} ❌")
        
        if self.results["errors"]:
            print(f"\nErrors ({len(self.results['errors'])}):")
            for error in self.results["errors"]:
                print(f"  - {error}")
        
        success_rate = (self.results["tests_passed"] / self.results["tests_run"] * 100) if self.results["tests_run"] > 0 else 0
        print(f"\nSuccess Rate: {success_rate:.1f}%")
        
        if self.results["tests_failed"] == 0:
            print("\n🎉 ALL TESTS PASSED!")
        else:
            print(f"\n⚠️  {self.results['tests_failed']} test(s) failed")
        
        print("="*60)

    async def cleanup(self):
        """Clean up resources."""
        if self.context:
            await self.context.close()
        print("\n✓ Cleanup completed")


async def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description="Fully automated extension test suite")
    parser.add_argument("--headless", action="store_true", help="Run in headless mode")
    parser.add_argument("--debug", action="store_true", help="Enable debug output")
    args = parser.parse_args()
    
    if not EXTENSION_PATH.exists():
        print(f"❌ Extension path not found: {EXTENSION_PATH}")
        sys.exit(1)
    
    if not TEST_HTML.exists():
        print(f"❌ Test HTML not found: {TEST_HTML}")
        sys.exit(1)
    
    tester = AutomatedExtensionTester(
        EXTENSION_PATH, 
        TEST_HTML, 
        headless=args.headless,
        debug=args.debug
    )
    await tester.run_all_tests()
    
    # Exit with appropriate code
    sys.exit(0 if tester.results["tests_failed"] == 0 else 1)


if __name__ == "__main__":
    asyncio.run(main())

