# MathJax Loading Fix

## Problem Identified

MathJax script loads successfully (`script.onload` fires), but the `MathJax` object is `undefined` immediately after. This is because:

1. **MathJax 3.x is asynchronous** - The script file loads, but MathJax itself initializes asynchronously
2. **Timing issue** - We were checking for `MathJax` too early (after only 100ms)
3. **No polling** - We weren't waiting for MathJax to actually become available

## Solution Implemented

Changed from immediate check to **polling approach**:

1. **Poll for MathJax object** - Check every 100ms if `MathJax` is available
2. **Wait up to 10 seconds** - Give MathJax time to initialize (100 attempts × 100ms)
3. **Check for required methods** - Once MathJax is found, verify `startup.promise` or `tex2mmlPromise` exists
4. **Better error messages** - Log exactly what's available if MathJax is found but missing methods

## Code Changes

**Before:**
```javascript
script.onload = () => {
  setTimeout(() => {
    if (typeof MathJax === 'undefined') {
      reject(new Error("MathJax object not available"));
    }
    // ... rest of code
  }, 100);
};
```

**After:**
```javascript
script.onload = () => {
  const checkMathJax = () => {
    if (typeof MathJax !== 'undefined') {
      // MathJax is ready!
      // Check for startup.promise or tex2mmlPromise
    } else {
      // Not ready yet, check again in 100ms
      setTimeout(checkMathJax, 100);
    }
  };
  setTimeout(checkMathJax, 100);
};
```

## Expected Behavior

After this fix:
1. Script loads ✅
2. Polls for MathJax object ✅
3. Waits for MathJax to initialize ✅
4. Checks for required methods ✅
5. Proceeds with conversion ✅

## Testing

1. **Reload extension** via `about:debugging`
2. **Select text with formula**
3. **Right-click → "Copy as Office Format"**
4. **Check console** - Should see:
   - `✅ MathJax script loaded`
   - `Checking MathJax (attempt X/100)...`
   - `✅ MathJax object found!`
   - `✅ MathJax startup complete!` (or `tex2mmlPromise available`)

## Status

✅ **Fix Applied** - MathJax should now initialize properly!

