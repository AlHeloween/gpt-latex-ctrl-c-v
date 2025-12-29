"""
Fully Automated Test Suite for "Copy as Office Format" Extension

This test runs 100% automatically - no manual steps required.

Usage:
    python test_automated.py [--browser chromium|firefox] [--headless] [--debug]
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
        """Build the Chromium MV3 extension dir (deterministic; ensures latest sources are copied)."""
        from lib.tools.build_chromium_extension import build  # type: ignore

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

        if self.browser_name == "chromium":
            sws = getattr(self.context, "service_workers", None)
            if sws:
                self.service_worker = sws[0] if sws else None
            if not self.service_worker:
                self.service_worker = await self.context.wait_for_event("serviceworker")

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

    async def trigger_copy(self, mode: str = "html") -> bool:
        """Trigger copy through the real background -> content-script message path."""
        self.log("Triggering copy via extension background...", "info")

        if self.browser_name != "chromium":
            self.log("Non-Chromium automated copy trigger is not supported", "warning")
            return False

        try:
            resp = await self._chromium_send_to_active_tab({"type": "COPY_OFFICE_FORMAT", "mode": mode})
            if resp and resp.get("ok"):
                self.log("Copy request completed", "success")
                return True
            err = (resp or {}).get("error") if isinstance(resp, dict) else None
            last_err = await self.page.evaluate(
                "() => document.documentElement?.dataset?.copyOfficeFormatLastCopyError || ''"
            )
            m = err or last_err or "unknown error"
            self.log(f"Copy request failed: {m}", "error")
            self.results["errors"].append(f"Copy failed: {m}")
            return False
        except Exception as e:
            self.log(f"Copy trigger failed: {e}", "error")
            self.results["errors"].append(f"Copy trigger error: {str(e)}")
            return False

    async def verify_clipboard_content(self, expected_token: str, before_sha: str, expect_formulas: bool) -> dict:
        """Verify OS clipboard content was updated by the extension."""
        self.log("Verifying OS clipboard content...", "info")

        verification = {
            "has_content": False,
            "has_html": False,
            "has_plain_text": False,
            "contains_omml": False,
            "contains_mathml": False,
            "no_parse_error_markers": True,
            "error": None,
        }

        if os.name != "nt":
            verification["error"] = "Windows-only clipboard verification skipped"
            return verification

        from lib.tools.win_clipboard_dump import dump_clipboard  # type: ignore

        deadline_s = 15.0
        poll_s = 0.2
        t0 = asyncio.get_running_loop().time()
        last = None
        while True:
            d = dump_clipboard()
            last = d
            sha = d.get("cfhtml_bytes_sha256") or ""
            plain = d.get("plain_text") or ""
            if sha and sha != before_sha and expected_token and expected_token in plain:
                break
            if asyncio.get_running_loop().time() - t0 >= deadline_s:
                break
            await asyncio.sleep(poll_s)

        if not last:
            verification["error"] = "clipboard read failed"
            return verification

        verification["has_content"] = True
        plain_text = str(last.get("plain_text", ""))
        if plain_text:
            verification["has_plain_text"] = True

        fragment = str(last.get("fragment", ""))
        if fragment:
            verification["has_html"] = True
            low = fragment.lower()
            if ("mso-element:omath" in low) or ("<m:omath" in low) or ("<m:omathpara" in low):
                verification["contains_omml"] = True
            if "http://www.w3.org/1998/Math/MathML" in low:
                verification["contains_mathml"] = True
            if "[PARSE ERROR:" in fragment:
                verification["no_parse_error_markers"] = False

        if expected_token and expected_token not in plain_text:
            verification["error"] = "clipboard did not update with expected token"
            return verification

        if expect_formulas and not (verification["contains_omml"] or verification["contains_mathml"]):
            verification["error"] = "clipboard missing OMML/MathML"
            return verification

        if not verification["no_parse_error_markers"]:
            verification["error"] = "clipboard contains PARSE ERROR markers"
            return verification

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

            token = (selected.strip().splitlines() or [""])[0][:64]
            before_sha = ""
            if os.name == "nt":
                try:
                    from lib.tools.win_clipboard_dump import dump_clipboard  # type: ignore

                    before_sha = dump_clipboard().get("cfhtml_bytes_sha256") or ""
                except Exception:
                    before_sha = ""

            # Trigger copy (selection already set)
            if not await self.trigger_copy("html"):
                self.results["tests_failed"] += 1
                return False
            
            # Verify clipboard
            verification = await self.verify_clipboard_content(
                expected_token=token,
                before_sha=before_sha,
                expect_formulas=expect_formulas,
            )
            
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

