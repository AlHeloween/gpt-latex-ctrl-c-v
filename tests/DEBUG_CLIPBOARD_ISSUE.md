# Debugging Clipboard Copy Issue

## Problem

Extension is activated but not copying anything to clipboard when formula is selected.

## Potential Issues

1. **Clipboard API Permissions**: Firefox may require explicit permissions
2. **User Gesture Requirement**: Clipboard API requires user gesture (right-click should work)
3. **Error Silently Swallowed**: Errors might be caught but not shown
4. **MathJax Loading**: If MathJax fails to load, the copy might fail
5. **Selection Loss**: Selection might be lost during async operations

## Debugging Steps

### 1. Check Browser Console

Open Firefox console (F12) and look for:
- `[Copy as Office Format]` messages
- Error messages
- Warnings about clipboard

### 2. Check Extension Console

1. Open `about:debugging`
2. Find the extension
3. Click "Inspect" next to "Copy as Office Format"
4. Check console for errors

### 3. Test with Simple Selection

1. Select plain text (no formulas)
2. Right-click → "Copy as Office Format"
3. Check if it works

### 4. Test Clipboard API Directly

Open browser console and run:
```javascript
navigator.clipboard.writeText("test").then(() => console.log("Success")).catch(e => console.error("Error:", e));
```

### 5. Check Manifest Permissions

Verify `manifest.json` has:
```json
"permissions": ["contextMenus", "activeTab", "clipboardWrite"]
```

## Common Issues

### Issue 1: Clipboard API Not Available
**Symptom**: No error, but nothing copied
**Solution**: Check if `navigator.clipboard` exists

### Issue 2: User Gesture Required
**Symptom**: Works sometimes, fails other times
**Solution**: Clipboard API requires user gesture (right-click is a gesture)

### Issue 3: MathJax Loading Fails
**Symptom**: Extension activates but copy fails
**Solution**: Check console for MathJax errors

### Issue 4: Selection Lost
**Symptom**: "Selection lost" message
**Solution**: Selection might be cleared during async operations

## Quick Fix Test

Add this to browser console to test clipboard:
```javascript
// Test if clipboard works
navigator.clipboard.writeText("test").then(() => {
    console.log("✅ Clipboard write works");
    return navigator.clipboard.readText();
}).then(text => {
    console.log("✅ Clipboard read works, content:", text);
}).catch(e => {
    console.error("❌ Clipboard error:", e);
});
```

## Next Steps

1. Enable DEBUG mode in content-script.js
2. Check console for detailed logs
3. Verify clipboard permissions
4. Test with simple text first
5. Then test with formulas

