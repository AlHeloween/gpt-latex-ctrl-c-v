# Debugging Guide for "Copy as Office Format" Extension

## Common Issues and Solutions

### Issue: Context Menu Doesn't Appear

**Symptoms:**
- Right-clicking on selected text doesn't show "Copy as Office Format" option

**Solutions:**
1. Verify extension is loaded:
   - Go to `about:debugging`
   - Click "This Firefox"
   - Find "Copy as Office Format" in the list
   - If not there, click "Load Temporary Add-on" and select `extension/manifest.json`

2. Reload the extension:
   - In `about:debugging`, click "Reload" next to the extension

3. Check for errors:
   - Open Browser Console (Ctrl+Shift+J)
   - Look for red error messages
   - Common errors:
     - "Extension is invalid" → Check manifest.json syntax
     - "Permission denied" → Check manifest permissions

### Issue: Context Menu Appears But Nothing Happens

**Symptoms:**
- Context menu shows "Copy as Office Format"
- Clicking it does nothing
- No visual feedback

**Solutions:**
1. Open Browser Console (Ctrl+Shift+J)
2. Look for console messages starting with `[Copy as Office Format]`
3. Check for errors in red

**Expected Console Output:**
```
[Copy as Office Format] Message received: {type: "COPY_OFFICE_FORMAT"}
[Copy as Office Format] handleCopy called
[Copy as Office Format] Selection HTML length: 123
[Copy as Office Format] Selection text length: 45
[Copy as Office Format] Copied to clipboard in Office format.
```

**If you see errors:**
- "Cannot send message" → Content script not loaded on this page
- "No text selected" → Selection was lost
- TeX conversion errors → WASM conversion failed (see console for details)

### Issue: Clipboard Operation Fails

**Symptoms:**
- Console shows "Copy failed" or clipboard errors

**Solutions:**
1. Check clipboard permissions:
   - Extension has `clipboardWrite` permission in manifest
   - Page must be active (not in background tab)

2. Try selecting text again:
   - Make sure text is actually selected (highlighted)
   - Try selecting a smaller portion

3. Check browser console for specific error messages

### Issue: Formulas Not Converting

**Symptoms:**
- Text copies but LaTeX formulas remain as raw text (e.g., `$x^2$`)

**Solutions:**
1. Check WASM bundle:
   - Ensure `extension/wasm/tex_to_mathml.wasm` exists and is up to date

2. Check XSLT loading:
   - Console should not show XSLT errors
   - Check `extension/assets/mathml2omml.xsl` exists

3. Verify LaTeX syntax:
   - Inline: `$formula$`
   - Display: `\[formula\]` or `\(formula\)`

### Testing on file:// URLs

**Note:** Firefox extensions work on `file://` URLs with `<all_urls>` in manifest.

**If content script doesn't load on file:// URLs:**
1. Check manifest has `"matches": ["<all_urls>"]`
2. Reload extension after changing manifest
3. Reload the test page

## Quick Diagnostic Steps

1. **Check Extension Status:**
   ```
   about:debugging → This Firefox → Find extension
   ```

2. **Check Console:**
   ```
   Press F12 → Console tab
   Look for [Copy as Office Format] messages
   ```

3. **Test Selection:**
   - Select text on page
   - Check `window.getSelection().toString()` in console
   - Should return selected text

4. **Test Message Sending:**
   - Open console
   - Type: `browser.runtime.sendMessage({type: "COPY_OFFICE_FORMAT"})`
   - Should trigger copy (if content script is loaded)

## Manual Test Procedure

1. Load extension via `about:debugging`
2. Open test HTML file: `examples/gemini-conversation-test.html`
3. Open Browser Console (F12)
4. Select text with formulas
5. Right-click → "Copy as Office Format"
6. Watch console for messages
7. Check clipboard (paste into Notepad to verify)

## Getting Help

If issues persist, provide:
- Browser console output (all messages)
- Extension ID from `about:debugging`
- Steps to reproduce
- Any error messages

