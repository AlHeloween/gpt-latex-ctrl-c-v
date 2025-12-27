# Plan: Implement AddonManager Extension Loading

## Overview

Adapt the Stack Overflow approach to load Firefox extensions using AddonManager API via DevTools console, bypassing Playwright's `--load-extension` limitation.

## Approach Analysis

The provided code uses:
1. Firefox's internal `AddonManager` API
2. DevTools console to execute JavaScript
3. Keyboard automation to interact with console
4. `installTemporaryAddon()` to load extensions

## Adaptations Needed

### 1. Directory vs XPI
- **Original:** Uses XPI files
- **Our case:** We have a directory-based extension
- **Solution:** Use directory path directly (AddonManager supports both)

### 2. Keyboard Automation
- **Original:** Uses keyboard to navigate DevTools
- **Challenge:** Fragile, may break with UI changes
- **Solution:** Try direct console evaluation if possible, fallback to keyboard

### 3. Implementation Location
- Add new method to `ComprehensiveExtensionTester`
- Make it optional (try AddonManager, fallback to --load-extension)
- Add flag: `--use-addonmanager`

## Implementation Plan

### Phase 1: Add AddonManager Loading Method

**File:** `tests/test_comprehensive.py`

**New Method:**
```python
async def _load_extension_via_addonmanager(self):
    """Load extension using Firefox AddonManager API."""
    # Open about:debugging
    # Open DevTools console
    # Execute AddonManager.installTemporaryAddon()
    # Verify extension loaded
```

### Phase 2: Adapt for Directory Extension

**Changes:**
- Use directory path instead of XPI
- Handle path conversion (Windows vs Unix)
- Verify AddonManager accepts directory paths

### Phase 3: Integrate into Setup

**Changes:**
- Add `--use-addonmanager` flag
- Try AddonManager method first
- Fallback to --load-extension if AddonManager fails
- Verify extension loaded after either method

### Phase 4: Error Handling

**Changes:**
- Handle DevTools console access errors
- Handle AddonManager API errors
- Provide clear error messages
- Fallback gracefully

## Code Structure

```python
async def setup(self, use_http_server: bool = False, use_addonmanager: bool = False):
    """Set up Playwright with Firefox and extension."""
    playwright = await async_playwright().start()
    
    if use_addonmanager:
        # Try AddonManager approach
        success = await self._load_extension_via_addonmanager()
        if not success:
            self.log("AddonManager loading failed, trying --load-extension", "warning")
            use_addonmanager = False
    
    if not use_addonmanager:
        # Use standard --load-extension approach
        self.context = await playwright.firefox.launch_persistent_context(...)
    
    # Continue with normal setup...
```

## Testing Strategy

1. Test AddonManager method with directory extension
2. Verify extension marker appears after loading
3. Compare success rate vs --load-extension
4. Test error handling and fallbacks

## Success Criteria

- Extension loads via AddonManager
- Content script injects correctly
- Extension marker is detected
- Tests can execute successfully

## Risks and Considerations

1. **Keyboard Automation**: May be fragile, UI changes could break it
2. **DevTools Access**: May require special permissions or setup
3. **Directory Paths**: Need to verify AddonManager accepts directory paths
4. **Headless Mode**: DevTools may not work in headless mode

## Alternative Approaches

If keyboard automation is too fragile:
1. Use Playwright's `page.evaluate()` to inject script directly
2. Use Firefox's `--jsconsole` flag to open console automatically
3. Use Firefox profile with extension pre-installed

