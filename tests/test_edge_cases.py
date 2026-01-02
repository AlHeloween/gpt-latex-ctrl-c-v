"""
Edge Cases and Error Handling Tests

Tests various edge cases and error conditions:
- Empty selection
- Large selection
- Selection loss
- Iframe content
- XSS protection
- Special HTML elements
- Error conditions
"""

import asyncio
import argparse
import json
import os
import sys
import threading
import tempfile
import shutil
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from playwright.async_api import async_playwright, BrowserContext, Page


PROJECT_ROOT = Path(__file__).parent.parent
EXTENSION_PATH = PROJECT_ROOT / "extension"
CHROMIUM_EXTENSION_PATH = PROJECT_ROOT / "dist" / "chromium"


class _QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        return


class EdgeCasesTester:
    def __init__(self, extension_path: Path, browser_name: str = "chromium", headless: bool = False, debug: bool = False):
        self.extension_path = extension_path
        self.browser_name = browser_name
        self.headless = headless
        self.debug = debug
        self._playwright = None
        self.context: BrowserContext = None
        self.page: Page = None
        self.service_worker = None
        self.results = {
            "tests_run": 0,
            "tests_passed": 0,
            "tests_failed": 0,
            "errors": []
        }
        self._httpd = None
        self._http_thread = None
        self._user_data_dir: Path | None = None

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

    def _ensure_chromium_extension(self) -> Path:
        """Build the Chromium MV3 extension dir."""
        from tools.build_chromium_extension import build  # type: ignore
        built = build(CHROMIUM_EXTENSION_PATH)
        return built

    async def setup(self):
        """Set up Playwright with a browser and the extension."""
        if self.browser_name == "chromium":
            extension_dir = self._ensure_chromium_extension()
            extension_path_str = str(extension_dir.absolute())
        else:
            extension_path_str = str(self.extension_path.absolute())

        self.log(f"Setting up {self.browser_name} with extension...", "info")
        self._playwright = await async_playwright().start()

        if self.browser_name == "chromium":
            if self.headless:
                self.headless = False

            self._user_data_dir = Path(tempfile.mkdtemp(prefix="playwright-chromium-ext-"))
            self.context = await self._playwright.chromium.launch_persistent_context(
                user_data_dir=self._user_data_dir,
                headless=False,
                args=[
                    f"--disable-extensions-except={extension_path_str}",
                    f"--load-extension={extension_path_str}",
                    "--disable-features=ExtensionManifestV2Disabled",
                    *(
                        []
                        if self.debug
                        else [
                            "--window-position=-32000,-32000",
                            "--window-size=800,600",
                            "--start-minimized",
                        ]
                    ),
                ],
            )
        elif self.browser_name == "firefox":
            self.context = await self._playwright.firefox.launch_persistent_context(
                user_data_dir=Path.home() / ".playwright-firefox-extension-test",
                headless=self.headless,
                args=[
                    f"--load-extension={extension_path_str}",
                ],
            )
        else:
            raise ValueError(f"Unsupported browser: {self.browser_name}")
        
        pages = self.context.pages
        if pages:
            self.page = pages[0]
        else:
            self.page = await self.context.new_page()
        
        self.log(f"{self.browser_name} launched with extension", "success")

        if self.browser_name == "chromium":
            sws = getattr(self.context, "service_workers", None)
            if sws:
                self.service_worker = sws[0] if sws else None
            if not self.service_worker:
                self.service_worker = await self.context.wait_for_event("serviceworker")

    async def load_test_page(self, test_html: Path):
        """Load a test HTML page."""
        if self.browser_name == "chromium":
            handler = lambda *a, **kw: _QuietHandler(*a, directory=str(PROJECT_ROOT), **kw)
            self._httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
            port = self._httpd.server_address[1]
            self._http_thread = threading.Thread(target=self._httpd.serve_forever, daemon=True)
            self._http_thread.start()

            rel = test_html.relative_to(PROJECT_ROOT).as_posix()
            url = f"http://127.0.0.1:{port}/{rel}"
            self.log(f"Loading test page: {url}", "info")
            await self.page.goto(url, wait_until="domcontentloaded")
        else:
            file_url = f"file://{test_html.absolute()}"
            self.log(f"Loading test page: {file_url}", "info")
            await self.page.goto(file_url, wait_until="domcontentloaded")

        await self.page.wait_for_selector("body", timeout=5000, state="attached")
        await self.page.wait_for_function(
            "() => document.readyState === 'interactive' || document.readyState === 'complete'",
            timeout=5000,
        )
        self.log("Test page loaded", "success")

    async def verify_extension_loaded(self) -> bool:
        """Verify extension content script is loaded."""
        self.log("Verifying extension is loaded...", "info")
        
        max_wait = 0.5
        check_interval = 0.1
        attempts = int(max_wait / check_interval)
        
        for attempt in range(attempts):
            is_loaded = await self.page.evaluate("""
                () => {
                    return document.documentElement &&
                           document.documentElement.dataset &&
                           document.documentElement.dataset.copyOfficeFormatExtensionLoaded === "true";
                }
            """)
            
            if is_loaded:
                self.log("Extension content script is active", "success")
                return True
            
            if attempt < attempts - 1:
                await asyncio.sleep(check_interval)
        
        self.log("Extension content script not found", "error")
        self.results["errors"].append("Extension content script not loaded")
        return False

    async def _chromium_send_to_active_tab(self, message: dict) -> dict | None:
        if self.browser_name != "chromium" or not self.service_worker:
            raise RuntimeError("chromium service worker unavailable")
        return await self.service_worker.evaluate(
            """
            async ({ message }) => {
                const chrome = globalThis.chrome;
                if (!chrome?.tabs) throw new Error("chrome.tabs unavailable");
                function call(fn, ...args) {
                    return new Promise((resolve, reject) => {
                        fn(...args, (result) => {
                            const err = chrome.runtime?.lastError;
                            if (err) reject(new Error(err.message || String(err)));
                            else resolve(result);
                        });
                    });
                }
                const tabs = await call(chrome.tabs.query, { active: true, currentWindow: true });
                const tabId = tabs && tabs[0] ? tabs[0].id : null;
                if (!tabId) throw new Error("no active tab");
                const resp = await call(chrome.tabs.sendMessage, tabId, message);
                return resp || null;
            }
            """,
            {"message": message},
        )

    async def trigger_copy(self, mode: str = "html") -> dict:
        """Trigger copy and return response."""
        self.log(f"Triggering copy (mode: {mode})...", "info")

        try:
            if mode == "markdown-export":
                message = {"type": "COPY_AS_MARKDOWN"}
            elif mode == "extract":
                message = {"type": "EXTRACT_SELECTED_HTML"}
            elif mode == "markdown":
                message = {"type": "COPY_OFFICE_FORMAT", "mode": "markdown"}
            else:
                message = {"type": "COPY_OFFICE_FORMAT", "mode": "html"}

            if self.browser_name == "chromium":
                resp = await self._chromium_send_to_active_tab(message)
            else:
                # Firefox - use page context
                resp = await self.page.evaluate(
                    """
                    async ({ message }) => {
                        const browser = globalThis.browser || globalThis.chrome;
                        if (!browser?.tabs) throw new Error("browser.tabs unavailable");
                        function call(fn, ...args) {
                            return new Promise((resolve, reject) => {
                                fn(...args, (result) => {
                                    const err = browser.runtime?.lastError;
                                    if (err) reject(new Error(err.message || String(err)));
                                    else resolve(result);
                                });
                            });
                        }
                        const tabs = await call(browser.tabs.query, { active: true, currentWindow: true });
                        const tabId = tabs && tabs[0] ? tabs[0].id : null;
                        if (!tabId) throw new Error("no active tab");
                        const resp = await call(browser.tabs.sendMessage, tabId, message);
                        return resp || null;
                    }
                    """,
                    {"message": message},
                )

            return resp or {}
        except Exception as e:
            self.log(f"Copy trigger failed: {e}", "error")
            return {"ok": False, "error": str(e)}

    async def run_test(self, test_name: str, test_html: Path, selector: str | None, expect_error: bool = False, expect_success: bool = True):
        """Run a single edge case test."""
        print(f"\n{'='*60}")
        print(f"TEST: {test_name}")
        print(f"{'='*60}")
        
        self.results["tests_run"] += 1
        
        try:
            # Load page
            await self.load_test_page(test_html)
            
            # Verify extension
            if not await self.verify_extension_loaded():
                self.results["tests_failed"] += 1
                return False

            # Select text if selector provided
            if selector:
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
                
                if not selected_text:
                    self.log("No text selected", "warning")
            else:
                # No selection - test empty selection handling
                await self.page.evaluate("""
                    () => {
                        const selection = window.getSelection();
                        selection.removeAllRanges();
                    }
                """)

            # Trigger copy
            resp = await self.trigger_copy("html")
            
            # Check results
            passed = False
            if expect_error:
                # Should fail gracefully
                if not resp.get("ok"):
                    passed = True
                    self.log("Test passed: Error handled gracefully", "success")
                else:
                    self.log("Test failed: Should have failed but succeeded", "error")
            elif expect_success:
                # Should succeed
                if resp.get("ok"):
                    passed = True
                    self.log("Test passed: Copy succeeded", "success")
                else:
                    error_msg = resp.get("error", "unknown")
                    # Empty selection error is expected
                    if "no selection" in error_msg.lower() and not selector:
                        passed = True
                        self.log("Test passed: Empty selection handled correctly", "success")
                    else:
                        self.log(f"Test failed: {error_msg}", "error")
            else:
                # Don't care about result, just that it doesn't crash
                passed = True
                self.log("Test passed: No crash", "success")
            
            if passed:
                self.results["tests_passed"] += 1
            else:
                self.results["tests_failed"] += 1
                self.results["errors"].append(f"{test_name}: {resp.get('error', 'unknown error')}")
            
            return passed
            
        except Exception as e:
            print(f"\n❌ TEST ERROR: {test_name} - {e}")
            self.results["tests_failed"] += 1
            self.results["errors"].append(f"{test_name}: {str(e)}")
            import traceback
            traceback.print_exc()
            return False

    async def run_all_tests(self):
        """Run all edge case tests."""
        print("="*60)
        print("EDGE CASES AND ERROR HANDLING TEST SUITE")
        if self.headless:
            print("Mode: HEADLESS")
        if self.debug:
            print("Mode: DEBUG (verbose output)")
        print("="*60)
        
        try:
            await self.setup()
            
            # Test 1: Empty selection
            await self.run_test(
                "Empty Selection",
                PROJECT_ROOT / "examples" / "test_error_conditions.html",
                None,
                expect_error=True,
            )
            
            # Test 2: Edge cases (formulas, special characters)
            await self.run_test(
                "Edge Cases (Formulas, Special Characters)",
                PROJECT_ROOT / "examples" / "test_edge_cases.html",
                "#edge-cases",
                expect_success=True,
            )
            
            # Test 3: Error conditions
            await self.run_test(
                "Error Conditions",
                PROJECT_ROOT / "examples" / "test_error_conditions.html",
                ".test-section",
                expect_success=True,
            )
            
            # Test 4: Links and special HTML
            if (PROJECT_ROOT / "examples" / "test_links.html").exists():
                await self.run_test(
                    "Links and Special HTML",
                    PROJECT_ROOT / "examples" / "test_links.html",
                    "body",
                    expect_success=True,
                )
            
            # Test 5: XSS protection
            if (PROJECT_ROOT / "examples" / "test_xss_payloads.html").exists():
                await self.run_test(
                    "XSS Protection",
                    PROJECT_ROOT / "examples" / "test_xss_payloads.html",
                    "body",
                    expect_success=True,
                )
            
            # Test 6: Large selection (if exists)
            if (PROJECT_ROOT / "examples" / "test_large_selection.html").exists():
                await self.run_test(
                    "Large Selection",
                    PROJECT_ROOT / "examples" / "test_large_selection.html",
                    "body",
                    expect_success=True,
                )
            
            # Test 7: Iframe content (if exists)
            if (PROJECT_ROOT / "examples" / "test_iframe.html").exists():
                await self.run_test(
                    "Iframe Content",
                    PROJECT_ROOT / "examples" / "test_iframe.html",
                    "body",
                    expect_success=True,
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
            self.context = None

        if self._playwright:
            await self._playwright.stop()
            self._playwright = None

        if getattr(self, "_httpd", None):
            try:
                self._httpd.shutdown()
                self._httpd.server_close()
            except Exception:
                pass
            self._httpd = None

        if self._user_data_dir:
            try:
                shutil.rmtree(self._user_data_dir, ignore_errors=True)
            except Exception:
                pass
            self._user_data_dir = None
        print("\n✓ Cleanup completed")


async def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description="Edge cases and error handling test suite")
    parser.add_argument("--browser", choices=["chromium", "firefox"], default="chromium",
                        help="Browser to use for testing (default: chromium)")
    parser.add_argument("--headless", action="store_true", help="Run in headless mode")
    parser.add_argument("--debug", action="store_true", help="Enable debug output")
    args = parser.parse_args()
    
    if not EXTENSION_PATH.exists():
        print(f"❌ Extension path not found: {EXTENSION_PATH}")
        sys.exit(1)
    
    tester = EdgeCasesTester(
        EXTENSION_PATH, 
        browser_name=args.browser,
        headless=args.headless,
        debug=args.debug
    )
    await tester.run_all_tests()
    
    sys.exit(0 if tester.results["tests_failed"] == 0 else 1)


if __name__ == "__main__":
    asyncio.run(main())
