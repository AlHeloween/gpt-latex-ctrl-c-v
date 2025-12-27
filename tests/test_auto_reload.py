"""
Automated Test Suite with Extension Reload and Copy/Paste Verification

This test suite:
1. Loads extension via about:debugging
2. Reloads extension when needed
3. Tests copy functionality
4. Verifies clipboard content (paste verification)

Usage:
    python tests/test_auto_reload.py [--headless] [--debug]
"""

import asyncio
import argparse
import json
import re
import sys
from pathlib import Path
from playwright.async_api import async_playwright, BrowserContext, Page, TimeoutError as PlaywrightTimeout
from typing import Dict, Optional, Tuple


PROJECT_ROOT = Path(__file__).parent.parent
EXTENSION_PATH = PROJECT_ROOT / "extension"
EXAMPLES_DIR = PROJECT_ROOT / "examples"
MANIFEST_PATH = EXTENSION_PATH / "manifest.json"


class AutoReloadTester:
    def __init__(self, extension_path: Path, headless: bool = False, debug: bool = False):
        self.extension_path = extension_path
        self.headless = headless
        self.debug = debug
        self.context: BrowserContext = None
        self.page: Page = None
        self.extension_id: Optional[str] = None
        self.passed = 0
        self.failed = 0
    
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
        """Set up Playwright with Firefox."""
        self.log("Setting up Firefox...", "info")
        playwright = await async_playwright().start()
        
        # Launch Firefox persistent context (allows extension management)
        self.context = await playwright.firefox.launch_persistent_context(
            user_data_dir=Path.home() / ".playwright-firefox-test-reload",
            headless=self.headless,
            args=[]  # No extension loaded initially
        )
        
        # Get or create page
        pages = self.context.pages
        if pages:
            self.page = pages[0]
        else:
            self.page = await self.context.new_page()
        
        self.log("Firefox launched", "success")
    
    async def load_extension_via_debugging(self) -> bool:
        """Load extension via about:debugging page."""
        self.log("Loading extension via about:debugging...", "info")
        
        try:
            # Navigate to about:debugging
            await self.page.goto("about:debugging#/runtime/this-firefox", wait_until="domcontentloaded", timeout=10000)
            await asyncio.sleep(1)  # Wait for page to load
            
            # Click "Load Temporary Add-on..." button
            self.log("Clicking 'Load Temporary Add-on...' button...", "debug")
            
            # Try to find and click the button
            try:
                # Look for button with text containing "Load" or "Temporary"
                load_button = await self.page.wait_for_selector(
                    'button:has-text("Load Temporary Add-on"), button:has-text("Load"), button[data-l10n-id="addons-debugging-load-temporary-addon"]',
                    timeout=5000
                )
                await load_button.click()
                await asyncio.sleep(0.5)
            except PlaywrightTimeout:
                # Try alternative selectors
                try:
                    load_button = await self.page.query_selector('button')
                    if load_button:
                        await load_button.click()
                        await asyncio.sleep(0.5)
                except Exception as e:
                    self.log(f"Could not find load button: {e}", "error")
                    return False
            
            # Handle file picker - select manifest.json
            self.log("Selecting manifest.json file...", "debug")
            async with self.page.expect_file_chooser() as fc_info:
                # The file chooser should appear after clicking the button
                pass
            
            file_chooser = await fc_info.value
            manifest_path_str = str(MANIFEST_PATH.absolute())
            await file_chooser.set_files(manifest_path_str)
            await asyncio.sleep(2)  # Wait for extension to load
            
            # Get extension ID from the page
            self.log("Extracting extension ID...", "debug")
            try:
                # Look for extension ID in the page
                extension_elements = await self.page.query_selector_all('[data-addon-id]')
                if extension_elements:
                    extension_id_attr = await extension_elements[0].get_attribute('data-addon-id')
                    if extension_id_attr:
                        self.extension_id = extension_id_attr
                        self.log(f"Extension ID: {self.extension_id}", "success")
                        return True
                
                # Alternative: look for UUID pattern in page content
                page_content = await self.page.content()
                uuid_pattern = r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
                matches = re.findall(uuid_pattern, page_content)
                if matches:
                    self.extension_id = matches[0]
                    self.log(f"Extension ID (from page): {self.extension_id}", "success")
                    return True
                
            except Exception as e:
                self.log(f"Could not extract extension ID: {e}", "warning")
            
            # If we can't get ID, assume it loaded if no errors
            self.log("Extension loaded (ID not extracted)", "success")
            return True
            
        except Exception as e:
            self.log(f"Failed to load extension: {e}", "error")
            return False
    
    async def reload_extension(self) -> bool:
        """Reload the extension."""
        self.log("Reloading extension...", "info")
        
        try:
            # Navigate to about:debugging
            await self.page.goto("about:debugging#/runtime/this-firefox", wait_until="domcontentloaded", timeout=10000)
            await asyncio.sleep(1)
            
            # Find reload button for our extension
            if self.extension_id:
                reload_button = await self.page.query_selector(f'[data-addon-id="{self.extension_id}"] button[title*="Reload"], [data-addon-id="{self.extension_id}"] button:has-text("Reload")')
            else:
                # Try to find any reload button
                reload_button = await self.page.query_selector('button:has-text("Reload"), button[title*="Reload"]')
            
            if reload_button:
                await reload_button.click()
                await asyncio.sleep(2)  # Wait for reload
                self.log("Extension reloaded", "success")
                return True
            else:
                self.log("Reload button not found, trying to reload via page refresh", "warning")
                await self.page.reload()
                await asyncio.sleep(2)
                return True
                
        except Exception as e:
            self.log(f"Failed to reload extension: {e}", "error")
            return False
    
    async def verify_extension_loaded(self) -> bool:
        """Verify extension content script is loaded."""
        self.log("Verifying extension is loaded...", "debug")
        
        try:
            # Check for extension marker
            result = await self.page.evaluate("""
                () => {
                    return typeof window.__copyOfficeFormatExtension !== 'undefined';
                }
            """)
            
            if result:
                self.log("Extension marker found", "success")
                return True
            
            # Check for browser.runtime
            result = await self.page.evaluate("""
                () => {
                    return typeof browser !== 'undefined' && typeof browser.runtime !== 'undefined';
                }
            """)
            
            if result:
                self.log("Extension runtime found", "success")
                return True
            
            self.log("Extension not detected", "error")
            return False
            
        except Exception as e:
            self.log(f"Error checking extension: {e}", "error")
            return False
    
    async def test_copy_with_formula(self, test_html: Path) -> Tuple[bool, str]:
        """Test copy functionality with LaTeX formula."""
        self.log(f"Testing copy with formula from {test_html.name}...", "info")
        
        try:
            # Load test page
            file_url = f"file://{test_html.absolute()}"
            await self.page.goto(file_url, wait_until="domcontentloaded", timeout=10000)
            await asyncio.sleep(1)
            
            # Verify extension is loaded
            if not await self.verify_extension_loaded():
                return False, "Extension not loaded"
            
            # Select text with formula
            self.log("Selecting text with formula...", "debug")
            await self.page.evaluate("""
                () => {
                    const walker = document.createTreeWalker(
                        document.body,
                        NodeFilter.SHOW_TEXT,
                        null,
                        false
                    );
                    
                    let node;
                    while (node = walker.nextNode()) {
                        if (node.textContent.includes('$') || node.textContent.includes('\\(')) {
                            const range = document.createRange();
                            range.selectNodeContents(node.parentElement || node);
                            const sel = window.getSelection();
                            sel.removeAllRanges();
                            sel.addRange(range);
                            return true;
                        }
                    }
                    return false;
                }
            """)
            
            await asyncio.sleep(0.5)
            
            # Trigger copy via context menu message
            self.log("Triggering copy...", "debug")
            copy_result = await self.page.evaluate("""
                async () => {
                    try {
                        if (typeof browser !== 'undefined' && browser.runtime) {
                            await browser.runtime.sendMessage({type: 'COPY_OFFICE_FORMAT'});
                            return {success: true};
                        }
                        return {success: false, error: 'browser.runtime not available'};
                    } catch (e) {
                        return {success: false, error: e.message};
                    }
                }
            """)
            
            if not copy_result.get('success'):
                return False, f"Copy trigger failed: {copy_result.get('error')}"
            
            # Wait for copy to complete
            await asyncio.sleep(2)
            
            # Verify clipboard content
            self.log("Verifying clipboard content...", "debug")
            clipboard_result = await self.page.evaluate("""
                async () => {
                    try {
                        const clipboardText = await navigator.clipboard.readText();
                        const clipboardItems = await navigator.clipboard.read();
                        
                        let htmlContent = null;
                        for (const item of clipboardItems) {
                            if (item.types.includes('text/html')) {
                                htmlContent = await item.getType('text/html').then(blob => blob.text());
                            }
                        }
                        
                        return {
                            success: true,
                            text: clipboardText,
                            html: htmlContent
                        };
                    } catch (e) {
                        return {success: false, error: e.message};
                    }
                }
            """)
            
            if not clipboard_result.get('success'):
                return False, f"Clipboard read failed: {clipboard_result.get('error')}"
            
            html_content = clipboard_result.get('html', '')
            text_content = clipboard_result.get('text', '')
            
            # Check for OMML namespace (Office Math)
            has_omml = 'm:oMath' in html_content or 'm:oMathPara' in html_content or 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"' in html_content
            
            # Check for CF_HTML format
            has_cf_html = html_content.startswith('Version:') or 'StartHTML:' in html_content or 'EndHTML:' in html_content
            
            # Check that LaTeX is converted (no raw $ signs in HTML)
            has_raw_latex = '$' in html_content and not has_omml
            
            if has_omml:
                self.log("✅ OMML found in clipboard (formulas converted)", "success")
            elif has_cf_html:
                self.log("✅ CF_HTML format found", "success")
            else:
                self.log("⚠️ Standard HTML format", "warning")
            
            if has_raw_latex:
                return False, "Raw LaTeX found in clipboard (formulas not converted)"
            
            return True, f"Clipboard verified: HTML length={len(html_content)}, Text length={len(text_content)}"
            
        except Exception as e:
            return False, f"Test failed: {str(e)}"
    
    async def run_tests(self):
        """Run all automated tests."""
        self.log("=" * 60, "info")
        self.log("Starting Automated Extension Tests", "info")
        self.log("=" * 60, "info")
        
        # Setup
        await self.setup()
        
        # Load extension
        if not await self.load_extension_via_debugging():
            self.log("Failed to load extension, aborting tests", "error")
            return
        
        # Find test HTML files
        test_dir = EXAMPLES_DIR
        test_files = list(test_dir.glob("*-test.html")) + list(test_dir.glob("test_*.html"))
        
        if not test_files:
            self.log("No test HTML files found", "error")
            return
        
        self.log(f"Found {len(test_files)} test files", "info")
        
        # Run tests
        for test_file in test_files[:3]:  # Test first 3 files
            self.log(f"\n--- Testing {test_file.name} ---", "info")
            
            # Reload extension before each test
            await self.reload_extension()
            await asyncio.sleep(1)
            
            # Run test
            success, message = await self.test_copy_with_formula(test_file)
            
            if success:
                self.log(f"✅ PASSED: {message}", "success")
                self.passed += 1
            else:
                self.log(f"❌ FAILED: {message}", "error")
                self.failed += 1
        
        # Summary
        self.log("\n" + "=" * 60, "info")
        self.log("Test Summary", "info")
        self.log("=" * 60, "info")
        self.log(f"Passed: {self.passed}", "success")
        self.log(f"Failed: {self.failed}", "error" if self.failed > 0 else "success")
        self.log(f"Total: {self.passed + self.failed}", "info")
    
    async def cleanup(self):
        """Clean up resources."""
        if self.context:
            await self.context.close()


async def main():
    parser = argparse.ArgumentParser(description="Automated Extension Test with Reload")
    parser.add_argument("--headless", action="store_true", help="Run in headless mode")
    parser.add_argument("--debug", action="store_true", help="Enable debug output")
    
    args = parser.parse_args()
    
    tester = AutoReloadTester(EXTENSION_PATH, headless=args.headless, debug=args.debug)
    
    try:
        await tester.run_tests()
    finally:
        await tester.cleanup()


if __name__ == "__main__":
    asyncio.run(main())

