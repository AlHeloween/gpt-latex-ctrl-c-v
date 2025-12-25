# Clipboard Debug Mode Enabled

## Changes Made

1. **Enabled DEBUG mode** in `content-script.js`
   - Set `DEBUG = true` for detailed logging
   - All console logs will now show

2. **Enhanced Error Logging** in `writeClipboard()`:
   - Logs when function is called
   - Logs content lengths
   - Logs each step of clipboard write
   - Logs detailed error information
   - Logs fallback attempts

3. **Enhanced Error Logging** in `handleCopy()`:
   - Logs when copy starts
   - Logs selection details
   - Logs each processing step
   - Logs detailed error information
   - Logs fallback attempts

## How to Debug

1. **Open Firefox Console** (F12)
2. **Load extension** via `about:debugging`
3. **Select text with formula**
4. **Right-click → "Copy as Office Format"**
5. **Check console** for detailed logs:
   - `[Copy as Office Format]` messages show each step
   - Error messages show what failed
   - Success messages confirm what worked

## What to Look For

### Success Flow:
```
[Copy as Office Format] Message received: {type: "COPY_OFFICE_FORMAT"}
[Copy as Office Format] handleCopy called
[Copy as Office Format] Selection HTML length: XXX
[Copy as Office Format] Selection text length: XXX
[Copy as Office Format] writeClipboard called
[Copy as Office Format] Creating ClipboardItem...
[Copy as Office Format] Writing to clipboard...
[Copy as Office Format] ✅ Clipboard write successful
[Copy as Office Format] ✅ Copy completed successfully
```

### Error Flow:
```
[Copy as Office Format] Error: [error message]
[Copy as Office Format] Error name: [error name]
[Copy as Office Format] Error message: [detailed message]
[Copy as Office Format] Error stack: [stack trace]
```

## Common Errors

### NotAllowedError
- **Cause**: Clipboard permission denied or no user gesture
- **Solution**: Ensure right-click is used (user gesture required)

### Clipboard API not available
- **Cause**: Browser doesn't support clipboard API
- **Solution**: Extension will use fallback execCommand

### Selection lost
- **Cause**: Selection cleared during async operations
- **Solution**: Selection capture should prevent this

## Next Steps

1. Test with console open
2. Check all log messages
3. Identify where it fails
4. Report specific error message

