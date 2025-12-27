# Problem Analysis - Quick Reference

## Top 10 Critical Issues to Fix

### 1. 🔴 Selection Loss During Async Operations
**File:** `extension/content-script.js`
**Fix:** Store selection range object, verify before clipboard write

### 2. 🔴 CF_HTML Byte Offset Wrong Encoding
**File:** `extension/content-script.js`
**Fix:** Use UTF-16 encoding for byte offsets (CF_HTML spec requirement)

### 3. 🔴 Memory Leak - Script Tags
**File:** `extension/content-script.js`
**Fix:** Remove script tag after MathJax loads: `script.remove()`

### 4. 🟠 XSS Risk - innerHTML with User Content
**File:** `extension/content-script.js`
**Fix:** Sanitize HTML or use DOMParser instead of innerHTML

### 5. 🟠 Context Menu Not Created on Reload
**File:** `extension/background.js`
**Fix:** Add `onStartup` listener and error handling

### 6. 🟠 MathJax Race Condition
**File:** `extension/content-script.js`
**Fix:** Use promise instead of boolean flag, prevent multiple loads

### 7. 🟠 Unhandled Promise Rejections
**File:** `extension/content-script.js`
**Fix:** Better error handling, prevent unhandled rejections

### 8. 🟡 Regex Edge Cases
**File:** `extension/content-script.js`
**Fix:** Handle escaped dollars, nested formulas, validate braces

### 9. 🟡 execCommand Deprecated
**File:** `extension/content-script.js`
**Fix:** Plan alternative fallback, monitor deprecation

### 10. 🟡 Unbounded Cache Growth
**File:** `extension/content-script.js`
**Fix:** Implement LRU cache with size limit

## Quick Fix Checklist

- [ ] Fix selection loss (store range, verify)
- [ ] Fix CF_HTML encoding (UTF-16)
- [ ] Remove script tags after load
- [ ] Sanitize HTML before innerHTML
- [ ] Fix context menu creation
- [ ] Fix MathJax race condition
- [ ] Improve error handling
- [ ] Fix regex patterns
- [ ] Add feature detection
- [ ] Limit cache size

## Testing Priorities

1. Test selection loss scenarios
2. Test CF_HTML format in Word
3. Test with large selections
4. Test with malformed LaTeX
5. Test error conditions
6. Test cross-frame selections
7. Test MathJax loading failures
8. Test clipboard permission denied

