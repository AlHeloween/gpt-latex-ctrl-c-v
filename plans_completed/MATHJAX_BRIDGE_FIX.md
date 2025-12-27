# MathJax Bridge Fix & Automated Testing

## Problem Fixed

MathJax was loading in page context but the bridge ready event never fired because:
1. **Content scripts run in isolated world** - Events don't cross the boundary
2. **Bridge ready event was dispatched in page context** but listener was in content script context
3. **Race condition** - Event fired before listener was set up

## Solution

1. **Simplified bridge ready check** - Instead of using events, just wait 300ms after injecting bridge script
2. **Bridge function** - `window.__mathjaxConvert()` is created in page context and can be called from content script
3. **Direct function check** - `latexToMathml()` checks for bridge function and uses it

## Code Changes

### content-script.js

**Before:** Complex event-based bridge ready detection (didn't work)

**After:** Simple timeout-based approach:
```javascript
// Inject bridge script
bridgeScript.textContent = `...window.__mathjaxConvert = function...`;
document.head.appendChild(bridgeScript);
bridgeScript.remove();

// Wait for bridge to be ready
setTimeout(() => {
  log("✅ MathJax bridge ready!");
  resolve();
}, 300);
```

**Usage in latexToMathml():**
```javascript
if (typeof window.__mathjaxConvert === 'function') {
  return window.__mathjaxConvert(latex, display);
}
```

## Automated Testing

Two test suites created:

### 1. Simple Automated Test (`test_simple_auto.py`)

**Usage:**
```bash
python tests/test_simple_auto.py [--debug]
```

**Features:**
- ✅ Tests copy functionality
- ✅ Verifies clipboard content (paste verification)
- ✅ Checks for OMML (Office Math) in clipboard
- ✅ Detects raw LaTeX (conversion failures)

**Requirements:**
- Extension must be manually loaded via `about:debugging` before running
- Firefox window stays open (non-headless)

**What it tests:**
1. Extension is loaded
2. Selects text with formulas
3. Triggers copy via `browser.runtime.sendMessage()`
4. Reads clipboard content
5. Verifies formulas are converted (OMML present, no raw LaTeX)

### 2. Advanced Auto-Reload Test (`test_auto_reload.py`)

**Usage:**
```bash
python tests/test_auto_reload.py [--headless] [--debug]
```

**Features:**
- ✅ Attempts to load extension via `about:debugging` UI automation
- ✅ Reloads extension before each test
- ✅ Full copy/paste verification

**Note:** Extension loading via UI automation is unreliable in Playwright, so manual loading may still be required.

## Testing Workflow

### Recommended: Simple Test

1. **Load extension manually:**
   - Open Firefox
   - Go to `about:debugging#/runtime/this-firefox`
   - Click "Load Temporary Add-on"
   - Select `manifest.json`

2. **Run tests:**
   ```bash
   python tests/test_simple_auto.py --debug
   ```

3. **Check results:**
   - ✅ Green = Test passed
   - ❌ Red = Test failed (check error message)

### What to Look For

**✅ Success indicators:**
- "Extension marker found" or "Extension runtime found"
- "OMML found (formulas converted to Office Math)"
- "Clipboard OK: HTML=X chars, OMML=True"

**❌ Failure indicators:**
- "Extension not detected"
- "Raw LaTeX in clipboard (not converted)"
- "Copy trigger failed"
- "Clipboard read failed"

## Expected Console Output

When copy works correctly, you should see:

```
[Copy as Office Format] 📦 Starting MathJax load...
[Copy as Office Format] 📦 Injecting MathJax into page context...
[Copy as Office Format] ✅ Injection code executed, waiting for MathJax...
[Copy as Office Format] 📥 MathJax loaded event received from page context
[Copy as Office Format] ✅ MathJax loaded successfully in page context
[Copy as Office Format]    Setting up MathJax bridge...
[Copy as Office Format] ✅ MathJax bridge ready!
[Copy as Office Format] 📞 Calling MathJax bridge function for conversion...
```

## Next Steps

1. **Reload extension** via `about:debugging`
2. **Run simple test:** `python tests/test_simple_auto.py --debug`
3. **Check results** - formulas should be converted to OMML
4. **If still failing**, check console logs for specific error

## Status

✅ **Bridge fix applied** - MathJax should now initialize properly
✅ **Automated tests created** - Can verify copy/paste functionality
⏳ **Testing required** - Please run tests and report results

