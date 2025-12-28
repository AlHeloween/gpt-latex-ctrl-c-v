"""
Fully Automated Test Suite for "Copy as Office Format" Extension

This test runs 100% automatically - no manual steps required.

Usage:
    python test_automated.py [--browser chromium|firefox] [--headless] [--debug]
"""

import asyncio
import argparse
import json
import sys
import threading
import tempfile
import shutil
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from playwright.async_api import async_playwright, BrowserContext, Page


PROJECT_ROOT = Path(__file__).parent.parent
EXTENSION_PATH = PROJECT_ROOT / "extension"
TEST_HTML = PROJECT_ROOT / "examples" / "gemini-conversation-test.html"

CHROMIUM_EXTENSION_PATH = PROJECT_ROOT / "dist" / "chromium"


class _QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        return


class AutomatedExtensionTester:
    def __init__(self, extension_path: Path, test_html: Path, browser_name: str = "chromium", headless: bool = False, debug: bool = False):
        self.extension_path = extension_path
        self.test_html = test_html
        self.browser_name = browser_name
        self.headless = headless
        self.debug = debug
        self._playwright = None
        self.context: BrowserContext = None
        self.page: Page = None
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
        """Build the Chromium MV3 extension dir (deterministic; ensures latest sources are copied)."""
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
        self.log(f"Extension path: {extension_path_str}", "debug")

        self._playwright = await async_playwright().start()

        if self.browser_name == "chromium":
            if self.headless:
                self.log("Chromium extension tests require headful mode; forcing headless=False", "warning")
                self.headless = False

            self._user_data_dir = Path(tempfile.mkdtemp(prefix="playwright-chromium-ext-"))
            self.context = await self._playwright.chromium.launch_persistent_context(
                user_data_dir=self._user_data_dir,
                headless=False,
                args=[
                    f"--disable-extensions-except={extension_path_str}",
                    f"--load-extension={extension_path_str}",
                    "--disable-features=ExtensionManifestV2Disabled",
                    # Keep the window off-screen unless explicitly debugging.
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
            # Note: Playwright+Firefox has known limitations around content-script injection.
            self.context = await self._playwright.firefox.launch_persistent_context(
                user_data_dir=Path.home() / ".playwright-firefox-extension-test",
                headless=self.headless,
                args=[
                    f"--load-extension={extension_path_str}",
                ],
            )
        else:
            raise ValueError(f"Unsupported browser: {self.browser_name}")
        
        # Get or create page
        pages = self.context.pages
        if pages:
            self.page = pages[0]
        else:
            self.page = await self.context.new_page()
        
        self.log(f"{self.browser_name} launched with extension", "success")

    async def load_test_page(self):
        """Load the test HTML page."""
        if self.browser_name == "chromium":
            # Chromium extensions don't reliably run on file:// without user toggles.
            # Serve the repo over localhost for predictable content-script injection.
            handler = lambda *a, **kw: _QuietHandler(*a, directory=str(PROJECT_ROOT), **kw)
            self._httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
            port = self._httpd.server_address[1]
            self._http_thread = threading.Thread(target=self._httpd.serve_forever, daemon=True)
            self._http_thread.start()

            rel = self.test_html.relative_to(PROJECT_ROOT).as_posix()
            url = f"http://127.0.0.1:{port}/{rel}"
            self.log(f"Loading test page: {url}", "info")
            await self.page.goto(url, wait_until="domcontentloaded")
        else:
            file_url = f"file://{self.test_html.absolute()}"
            self.log(f"Loading test page: {file_url}", "info")
            await self.page.goto(file_url, wait_until="domcontentloaded")

        # Prove the DOM is usable by mutating it and reading the mutation back.
        # This avoids "networkidle" hangs (e.g., analytics, CDN scripts, long polling).
        await self.page.wait_for_selector("body", timeout=5000, state="attached")
        await self.page.wait_for_function(
            "() => document.readyState === 'interactive' || document.readyState === 'complete'",
            timeout=5000,
        )
        probe_value = await self.page.evaluate(
            """
            () => {
                const value = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
                let el = document.getElementById("__pw_dom_probe");
                if (!el) {
                    el = document.createElement("div");
                    el.id = "__pw_dom_probe";
                    el.style.display = "none";
                    document.documentElement.appendChild(el);
                }
                el.textContent = value;
                return value;
            }
            """
        )
        await self.page.wait_for_function(
            """(expected) => document.getElementById("__pw_dom_probe")?.textContent === expected""",
            arg=probe_value,
            timeout=5000,
        )
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
        
        # Extension not loaded - this means wrong setup
        self.log("Extension content script not found (DOM marker missing)", "error")
        self.log("  This indicates the extension is not properly loaded", "error")
        self.log("  Check: extension loading flags and manifest compatibility", "error")
        self.results["errors"].append("Extension content script not loaded - check extension loading")
        return False

    async def select_text_automatically(self, selector: str) -> str:
        """Automatically select text from an element."""
        self.log(f"Selecting text from: {selector}", "info")
        
        # Wait for element to exist (max 0.5 seconds)
        try:
            await self.page.wait_for_selector(selector, timeout=2000, state="attached")
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

    async def trigger_copy_via_test_hook(self, selector: str | None = None) -> bool:
        """Trigger copy via the test-only DOM hook exposed on file:// test pages."""
        self.log("Triggering copy function...", "info")
        
        try:
            result = await self.page.evaluate("""
                async ({ selector }) => {
                    const isTest = document.documentElement &&
                                   document.documentElement.dataset &&
                                   document.documentElement.dataset.copyOfficeFormatExtensionLoaded === "true";
                    if (!isTest) return { success: false, error: "Test hook not available (DOM marker missing)" };

                    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
                    const outcome = await new Promise((resolve) => {
                        const onResult = (event) => {
                            const detail = (event && event.detail) ? event.detail : {};
                            if (detail.requestId !== requestId) return;
                            window.removeEventListener("__copyOfficeFormatTestResult", onResult);
                            resolve(detail);
                        };
                        window.addEventListener("__copyOfficeFormatTestResult", onResult);
                        window.dispatchEvent(new CustomEvent("__copyOfficeFormatTestRequest", { detail: { requestId, selector } }));
                        setTimeout(() => {
                            window.removeEventListener("__copyOfficeFormatTestResult", onResult);
                            resolve({ requestId, ok: false, error: "timeout" });
                        }, 10000);
                    });

                    return { success: !!outcome.ok, error: outcome.error || null };
                }
            """, {"selector": selector})
            
            if result.get("success"):
                self.log("Copy request completed", "success")
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
        """Verify last copy payload captured by the content-script test hook."""
        self.log("Verifying copy payload...", "info")

        clipboard_data = await self.page.evaluate("""
            () => {
                const bridge = document.getElementById("__copyOfficeFormatTestBridge");
                if (!bridge || !bridge.value) return { error: "No captured payload (bridge missing)" };
                try {
                    const parsed = JSON.parse(bridge.value);
                    return parsed.lastClipboard || { error: "No lastClipboard in bridge" };
                } catch (e) {
                    return { error: "Failed to parse bridge payload" };
                }
            }
        """)
        
        verification = {
            "has_content": False,
            "has_html": False,
            "has_plain_text": False,
            "contains_omml": False,
            "contains_mathml": False,
            "no_raw_latex": True,
            "no_parse_error_markers": True,
            "error": None,
        }
        
        if "error" in clipboard_data:
            verification["error"] = clipboard_data.get("error")
            self.log(f"Payload error: {verification['error']}", "warning")
            return verification
        
        if not clipboard_data:
            self.log("No payload captured", "error")
            return verification
        
        verification["has_content"] = True
        
        # Check for HTML (CF_HTML payload)
        html_content = clipboard_data.get("cfhtml", "") or ""
        if html_content:
            verification["has_html"] = True
            self.log(f"Clipboard contains HTML ({len(html_content)} chars)", "success")
            self.log(f"  HTML preview: {html_content[:100]}...", "debug")
            
            # Detect Office-friendly OMML embedding (preferred for Word) and MathML (fallback/compat).
            low = html_content.lower()
            if ("mso-element:omath" in low) or ("<m:omath" in low) or ("<m:omathpara" in low):
                verification["contains_omml"] = True
                self.log("Clipboard HTML contains OMML/Office math markers", "success")
            
            # Check for MathML
            if "http://www.w3.org/1998/Math/MathML" in html_content:
                verification["contains_mathml"] = True
                self.log("Clipboard HTML contains MathML namespace", "success")
            
            # We provide raw HTML (no Windows CF_HTML header). The browser/OS clipboard layer can
            # translate this into platform clipboard formats (e.g., Windows "HTML Format").
            if ("starthtml:" in low) or ("endhtml:" in low) or ("startfragment:" in low):
                verification["error"] = "Clipboard HTML unexpectedly contains CF_HTML header fields"
                self.log(verification["error"], "error")
                return verification
            
            # Check for raw LaTeX (should not be present if converted)
            import re
            if re.search(r'\$[^$]+\$|\\\[.*?\\\]', html_content):
                verification["no_raw_latex"] = False
                self.log("Warning: Clipboard contains raw LaTeX (may not be converted)", "warning")
            else:
                self.log("No raw LaTeX found (formulas likely converted)", "success")

            # Guardrail: do not emit placeholder parse errors into clipboard HTML/MathML.
            if "[PARSE ERROR:" in html_content:
                verification["no_parse_error_markers"] = False
                self.log("Clipboard contains PARSE ERROR markers (conversion produced placeholders)", "error")
        
        # Check for plain text
        plain_text = clipboard_data.get("plainText", "") if isinstance(clipboard_data, dict) else ""
        if plain_text:
            verification["has_plain_text"] = True
            text_len = len(plain_text)
            self.log(f"Clipboard contains plain text ({text_len} chars)", "success")
            self.log(f"  Text preview: {plain_text[:50]}...", "debug")
        
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
            if not await self.trigger_copy_via_test_hook(selector):
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
                elif not verification.get("no_parse_error_markers", True):
                    passed = False
                    print("✗ Clipboard contains PARSE ERROR placeholders")
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

            # Test 4: Forced Rust WASM conversion (no external renderer fallback)
            original_test_html = self.test_html
            try:
                self.test_html = PROJECT_ROOT / "examples" / "force-wasm-latex-test.html"
                await self.run_test(
                    "Forced Rust WASM LaTeX Conversion",
                    "#content",
                    expect_formulas=True,
                )
                self.test_html = PROJECT_ROOT / "examples" / "force-wasm-unicode-math-test.html"
                await self.run_test(
                    "Forced Rust WASM Unicode Normalization",
                    "#content",
                    expect_formulas=True,
                )
            finally:
                self.test_html = original_test_html
             
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
    parser = argparse.ArgumentParser(description="Fully automated extension test suite")
    parser.add_argument("--browser", choices=["chromium", "firefox"], default="chromium",
                        help="Browser to use for automated testing (default: chromium)")
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
        browser_name=args.browser,
        headless=args.headless,
        debug=args.debug
    )
    await tester.run_all_tests()
    
    # Exit with appropriate code
    sys.exit(0 if tester.results["tests_failed"] == 0 else 1)


if __name__ == "__main__":
    asyncio.run(main())

