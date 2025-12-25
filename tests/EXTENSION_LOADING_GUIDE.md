# Extension Loading Guide

## Problem

Firefox extensions loaded via Playwright's `--load-extension` flag may not inject content scripts into file:// URLs. This is a known limitation with Firefox extension testing.

## Solutions

### Solution 1: Manual Loading (Recommended for Testing)

1. **Load Extension Manually:**
   - Open Firefox
   - Navigate to `about:debugging`
   - Click "This Firefox"
   - Click "Load Temporary Add-on"
   - Select `manifest.json` from the extension directory

2. **Use Manual Testing Helper:**
   ```bash
   python tests/test_manual_helper.py
   ```
   This opens all test pages for manual verification.

3. **Or Use Debug Page:**
   - Open `tests/debug-extension.html` in Firefox
   - Use the interactive buttons to test extension functions
   - Check extension status in the log

### Solution 2: HTTP Server (May Improve Loading)

Try using HTTP server instead of file:// URLs:

```bash
python tests/test_comprehensive.py --http-server --phase critical
```

This serves test pages via HTTP which may allow better content script injection.

### Solution 3: Verify Extension Marker

The extension now exposes a marker for detection:

```javascript
// In browser console on any page:
window.__copyOfficeFormatExtension
// Should return: {version: '0.2.0', loaded: true, ready: true, ...}
```

If this marker exists, the extension content script is loaded.

## Extension Detection Methods

The test suite uses multiple detection methods:

1. **Extension Marker** (Primary): `window.__copyOfficeFormatExtension`
2. **Browser API** (Secondary): `browser.runtime`
3. **Extension Ready Notification** (Future): Message from content script to background

## Troubleshooting

### Extension Marker Not Found

- **Check 1**: Verify extension is loaded in `about:debugging`
- **Check 2**: Check browser console for errors
- **Check 3**: Verify `manifest.json` is valid
- **Check 4**: Try HTTP server option instead of file:// URLs

### Content Script Not Injecting

- **Cause**: Firefox may restrict content script injection into file:// URLs
- **Solution**: Use HTTP server or manual loading
- **Workaround**: Load extension manually and use manual testing workflow

### Browser API Not Available

- **Cause**: Content script may not have loaded yet
- **Solution**: Wait longer (tests wait up to 5 seconds)
- **Check**: Verify extension marker exists first

## Testing Workflow

### Automated Testing (When Extension Loads)

```bash
# Run all tests
python tests/test_comprehensive.py

# Run with HTTP server
python tests/test_comprehensive.py --http-server

# Run specific phase
python tests/test_comprehensive.py --phase critical --debug
```

### Manual Testing (Recommended)

```bash
# 1. Load extension via about:debugging
# 2. Run helper script
python tests/test_manual_helper.py

# 3. Test each page manually
# 4. Verify in Microsoft Word
```

## Extension Marker API

The extension exposes the following marker:

```javascript
window.__copyOfficeFormatExtension = {
  version: '0.2.0',
  loaded: true,
  ready: true,
  checkStatus: function() {
    return {
      extensionLoaded: boolean,
      mathJaxLoaded: boolean,
      xsltLoaded: boolean,
      selection: object | null
    };
  }
}
```

Use this in browser console to verify extension is loaded:

```javascript
// Check if extension is loaded
if (window.__copyOfficeFormatExtension) {
  console.log("Extension loaded:", window.__copyOfficeFormatExtension.checkStatus());
} else {
  console.log("Extension not loaded");
}
```

## Next Steps

1. **If automated tests fail**: Use manual testing workflow
2. **If extension marker exists**: Extension is loaded, investigate why tests fail
3. **If extension marker missing**: Extension not loading, check manifest.json and about:debugging

