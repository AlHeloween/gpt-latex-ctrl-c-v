# Quick Debug Guide

## Step 1: Open Debug Helper Page

1. Load extension via `about:debugging` → "This Firefox" → "Load Temporary Add-on" → select `extension/manifest.json`
2. Open `examples/debug-extension.html` in Firefox
3. The page will automatically check if extension is loaded

## Step 2: Test Extension Status

Click "Check Extension Status" button. You should see:

- ✅ Green status = Extension is working
- ❌ Red status = Extension not loaded

## Step 3: Test Manual Copy

1. Select the test text on the page (it has formulas: `$x^2 + y^2 = z^2$`)
2. Right-click → "Copy as Office Format"
3. Watch the Debug Log for messages
4. Click "Check Clipboard Content" to verify

## Step 4: Test Programmatic Copy

1. Click "Trigger Copy Programmatically" button
2. This automatically selects text and triggers copy
3. Check the log for any errors

## Step 5: Check Browser Console

Press F12 and check the Console tab for:

- `[Copy as Office Format]` messages
- Any red error messages

## What to Look For

### ✅ Working Correctly:

- Extension status shows green
- Debug log shows "Message sent successfully"
- Clipboard contains HTML with OMML namespace
- No raw LaTeX in clipboard (formulas converted)

### ❌ Common Issues:

**Extension not loaded:**

- Status shows red
- Solution: Reload extension in `about:debugging`

**Message send fails:**

- Log shows "Failed to send message"
- Solution: Reload the page after loading extension

**No selection:**

- Log shows "No text selected"
- Solution: Make sure text is actually highlighted

**Clipboard read error:**

- Usually "NotAllowedError"
- Solution: Page must be active, try clicking on page first

## Console Commands

You can also test directly in browser console (F12):

```javascript
// Check if extension is loaded
typeof browser !== "undefined" && typeof browser.runtime !== "undefined";

// Trigger copy manually
browser.runtime.sendMessage({ type: "COPY_OFFICE_FORMAT" });

// Check selection
window.getSelection().toString();
```

## Next Steps

If extension is working on debug page but not on your test page:

1. Check if test page is using `file://` URL (should work)
2. Reload test page after loading extension
3. Check browser console for errors specific to that page
