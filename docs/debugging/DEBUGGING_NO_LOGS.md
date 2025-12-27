# Debugging: No Logs When Activating Extension

## Problem

When selecting text with formulas and activating the extension (right-click → "Copy as Office Format"), **nothing happens** - not even debug logs appear.

## Possible Causes

### 1. Content Script Not Loaded
- Extension might not be loaded properly
- Content script might not be injected into the page
- Check: `window.__copyOfficeFormatExtension` in console

### 2. Message Not Reaching Content Script
- Background script sends message but content script doesn't receive it
- Tab might not match manifest patterns
- Extension might not be active on the page

### 3. JavaScript Error Preventing Execution
- Syntax error in content script
- Runtime error during initialization
- Check browser console for errors

## Debugging Steps

### Step 1: Verify Extension is Loaded

Open browser console (F12) and run:
```javascript
// Check if extension marker exists
typeof window.__copyOfficeFormatExtension

// Check if browser API is available
typeof browser !== 'undefined' && typeof browser.runtime !== 'undefined'

// Check if content script is loaded
document.querySelector('script[src*="content-script"]')
```

### Step 2: Check Background Script Console

1. Go to `about:debugging`
2. Find your extension
3. Click "Inspect" next to "Copy as Office Format"
4. Check console for background script logs
5. Look for: `[Copy as Office Format Background]` messages

### Step 3: Check Content Script Console

1. Open page where you're testing
2. Open browser console (F12)
3. Look for: `[Copy as Office Format]` messages
4. Check for any red error messages

### Step 4: Test Message Sending Manually

In browser console, try:
```javascript
// Test if message can be sent
browser.runtime.sendMessage({type: "COPY_OFFICE_FORMAT"})
  .then(response => console.log("Response:", response))
  .catch(err => console.error("Error:", err));
```

### Step 5: Check Context Menu

1. Right-click on selected text
2. Verify "Copy as Office Format" appears in menu
3. If it doesn't appear:
   - Extension might not be loaded
   - Context menu might not be created
   - Check background script console

## Enhanced Logging Added

I've added extensive logging to both:
- ✅ Background script (now DEBUG = true)
- ✅ Content script (already DEBUG = true)

You should now see:
- `🔵 Context menu clicked!` - When menu item is clicked
- `📤 Sending COPY_OFFICE_FORMAT message` - When message is sent
- `🔵 Message received in content script!` - When message arrives
- `🔵 handleCopy() called - START` - When copy starts

## What to Check

1. **Background Script Console** (`about:debugging` → Inspect):
   - Do you see "Context menu clicked"?
   - Do you see "Sending message"?
   - Any errors?

2. **Page Console** (F12 on the page):
   - Do you see "Message received"?
   - Do you see "handleCopy() called"?
   - Any errors?

3. **Extension Status**:
   - Is extension loaded? (`window.__copyOfficeFormatExtension`)
   - Is context menu visible?
   - Is page URL allowed? (should be `<all_urls>`)

## Next Steps

After enabling enhanced logging:
1. Reload extension via `about:debugging`
2. Reload the test page
3. Select text with formula
4. Right-click → "Copy as Office Format"
5. Check BOTH consoles:
   - Background script console (`about:debugging` → Inspect)
   - Page console (F12)

Share what you see (or don't see) in the logs!

