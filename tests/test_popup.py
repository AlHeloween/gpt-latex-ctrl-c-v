"""
Popup Functionality Tests

Tests the browser action popup:
- Enable/disable toggle
- Language selection
- Settings link
- Storage persistence
"""

import asyncio
import argparse
import json
import sys
import tempfile
import shutil
from pathlib import Path
from playwright.async_api import async_playwright, BrowserContext, Page


PROJECT_ROOT = Path(__file__).parent.parent
EXTENSION_PATH = PROJECT_ROOT / "extension"
CHROMIUM_EXTENSION_PATH = PROJECT_ROOT / "dist" / "chromium"


class PopupTester:
    def __init__(self, extension_path: Path, browser_name: str = "chromium", headless: bool = False, debug: bool = False):
        self.extension_path = extension_path
        self.browser_name = browser_name
        self.headless = headless
        self.debug = debug
        self._playwright = None
        self.context: BrowserContext = None
        self.page: Page = None
        self.popup_page: Page | None = None
        self.service_worker = None
        self.results = {
            "tests_run": 0,
            "tests_passed": 0,
            "tests_failed": 0,
            "errors": []
        }
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

    async def open_popup(self) -> bool:
        """Open the extension popup."""
        self.log("Opening extension popup...", "info")
        
        try:
            if self.browser_name == "chromium":
                # Get extension ID
                background_page = self.context.background_pages[0] if self.context.background_pages else None
                if not background_page:
                    self.log("No background page found", "error")
                    return False
                
                # Get extension ID from background page
                extension_id = await background_page.evaluate("""
                    () => {
                        const chrome = globalThis.chrome;
                        if (!chrome?.runtime) return null;
                        return chrome.runtime.id;
                    }
                """)
                
                if not extension_id:
                    self.log("Could not get extension ID", "error")
                    return False
                
                # Open popup
                popup_url = f"chrome-extension://{extension_id}/popup.html"
                self.popup_page = await self.context.new_page()
                await self.popup_page.goto(popup_url, wait_until="domcontentloaded")
                self.log("Popup opened", "success")
                return True
            else:
                # Firefox - popup handling is different
                self.log("Firefox popup testing not yet implemented", "warning")
                return False
        except Exception as e:
            self.log(f"Failed to open popup: {e}", "error")
            return False

    async def get_storage_config(self) -> dict:
        """Get current storage configuration."""
        if self.browser_name == "chromium" and self.service_worker:
            return await self.service_worker.evaluate("""
                async () => {
                    const chrome = globalThis.chrome;
                    if (!chrome?.storage) return {};
                    return new Promise((resolve) => {
                        chrome.storage.local.get("gptLatexCtrlCVConfig", (result) => {
                            resolve(result.gptLatexCtrlCVConfig || {});
                        });
                    });
                }
            """)
        return {}

    async def verify_storage_config(self, expected: dict) -> bool:
        """Verify storage configuration matches expected values."""
        config = await self.get_storage_config()
        
        for key, value in expected.items():
            if isinstance(value, dict):
                if not isinstance(config.get(key), dict):
                    return False
                for subkey, subvalue in value.items():
                    if config.get(key, {}).get(subkey) != subvalue:
                        self.log(f"Config mismatch: {key}.{subkey} = {config.get(key, {}).get(subkey)}, expected {subvalue}", "debug")
                        return False
            else:
                if config.get(key) != value:
                    self.log(f"Config mismatch: {key} = {config.get(key)}, expected {value}", "debug")
                    return False
        
        return True

    async def run_test(self, test_name: str, test_func):
        """Run a single popup test."""
        print(f"\n{'='*60}")
        print(f"TEST: {test_name}")
        print(f"{'='*60}")
        
        self.results["tests_run"] += 1
        
        try:
            passed = await test_func()
            
            if passed:
                self.log(f"TEST PASSED: {test_name}", "success")
                self.results["tests_passed"] += 1
            else:
                self.log(f"TEST FAILED: {test_name}", "error")
                self.results["tests_failed"] += 1
                self.results["errors"].append(f"{test_name}: Test failed")
            
            return passed
            
        except Exception as e:
            print(f"\n❌ TEST ERROR: {test_name} - {e}")
            self.results["tests_failed"] += 1
            self.results["errors"].append(f"{test_name}: {str(e)}")
            import traceback
            traceback.print_exc()
            return False

    async def test_enable_disable_toggle(self) -> bool:
        """Test enable/disable translation toggle."""
        if not await self.open_popup():
            return False
        
        try:
            # Find the enable checkbox
            checkbox = await self.popup_page.wait_for_selector("#enable-translation", timeout=5000)
            if not checkbox:
                self.log("Enable checkbox not found", "error")
                return False
            
            # Get initial state
            initial_checked = await checkbox.is_checked()
            self.log(f"Initial state: enabled={initial_checked}", "debug")
            
            # Toggle on
            await checkbox.click()
            await asyncio.sleep(0.5)  # Wait for storage update
            
            # Verify storage updated
            if not await self.verify_storage_config({"translation": {"enabled": True}}):
                self.log("Storage not updated after enabling", "error")
                return False
            
            # Toggle off
            await checkbox.click()
            await asyncio.sleep(0.5)  # Wait for storage update
            
            # Verify storage updated
            if not await self.verify_storage_config({"translation": {"enabled": False}}):
                self.log("Storage not updated after disabling", "error")
                return False
            
            self.log("Enable/disable toggle works", "success")
            return True
        except Exception as e:
            self.log(f"Toggle test failed: {e}", "error")
            return False

    async def test_language_selection(self) -> bool:
        """Test language selection."""
        if not await self.open_popup():
            return False
        
        try:
            # Find language select elements
            lang_selects = await self.popup_page.query_selector_all("select.language-select")
            if len(lang_selects) == 0:
                self.log("Language selects not found", "error")
                return False
            
            # Select a language in the first select
            first_select = lang_selects[0]
            await first_select.select_option("es")  # Spanish
            await asyncio.sleep(0.5)  # Wait for storage update
            
            # Verify storage updated
            config = await self.get_storage_config()
            target_langs = config.get("translation", {}).get("targetLanguages", [])
            if "es" not in target_langs:
                self.log("Language not saved to storage", "error")
                return False
            
            self.log("Language selection works", "success")
            return True
        except Exception as e:
            self.log(f"Language selection test failed: {e}", "error")
            return False

    async def test_settings_link(self) -> bool:
        """Test settings link opens options page."""
        if not await self.open_popup():
            return False
        
        try:
            # Find settings link
            settings_link = await self.popup_page.wait_for_selector("a[href*='options.html']", timeout=5000)
            if not settings_link:
                self.log("Settings link not found", "error")
                return False
            
            # Click settings link (this will open in new tab)
            # Note: We can't easily verify the new tab opened, but we can check the link exists
            href = await settings_link.get_attribute("href")
            if not href or "options.html" not in href:
                self.log("Settings link href incorrect", "error")
                return False
            
            self.log("Settings link exists and has correct href", "success")
            return True
        except Exception as e:
            self.log(f"Settings link test failed: {e}", "error")
            return False

    async def run_all_tests(self):
        """Run all popup tests."""
        print("="*60)
        print("POPUP FUNCTIONALITY TEST SUITE")
        if self.headless:
            print("Mode: HEADLESS")
        if self.debug:
            print("Mode: DEBUG (verbose output)")
        print("="*60)
        
        try:
            await self.setup()
            
            # Test 1: Enable/disable toggle
            await self.run_test(
                "Enable/Disable Toggle",
                self.test_enable_disable_toggle
            )
            
            # Test 2: Language selection
            await self.run_test(
                "Language Selection",
                self.test_language_selection
            )
            
            # Test 3: Settings link
            await self.run_test(
                "Settings Link",
                self.test_settings_link
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
        if self.popup_page:
            await self.popup_page.close()
            self.popup_page = None
        
        if self.context:
            await self.context.close()
            self.context = None

        if self._playwright:
            await self._playwright.stop()
            self._playwright = None

        if self._user_data_dir:
            try:
                shutil.rmtree(self._user_data_dir, ignore_errors=True)
            except Exception:
                pass
            self._user_data_dir = None
        print("\n✓ Cleanup completed")


async def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description="Popup functionality test suite")
    parser.add_argument("--browser", choices=["chromium", "firefox"], default="chromium",
                        help="Browser to use for testing (default: chromium)")
    parser.add_argument("--headless", action="store_true", help="Run in headless mode")
    parser.add_argument("--debug", action="store_true", help="Enable debug output")
    args = parser.parse_args()
    
    if not EXTENSION_PATH.exists():
        print(f"❌ Extension path not found: {EXTENSION_PATH}")
        sys.exit(1)
    
    tester = PopupTester(
        EXTENSION_PATH, 
        browser_name=args.browser,
        headless=args.headless,
        debug=args.debug
    )
    await tester.run_all_tests()
    
    sys.exit(0 if tester.results["tests_failed"] == 0 else 1)


if __name__ == "__main__":
    asyncio.run(main())
