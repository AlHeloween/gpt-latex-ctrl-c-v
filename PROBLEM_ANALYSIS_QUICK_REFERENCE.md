# Problem Analysis - Quick Reference

## Top 10 Critical Issues to Fix

### 1. 🔴 Selection Loss During Async Operations
**File:** `content-script.js:16-77`
**Fix:** Store selection range object, verify before clipboard write

### 2. 🔴 CF_HTML Byte Offset Wrong Encoding
**File:** `content-script.js:269-303`
**Fix:** Use UTF-16 encoding for byte offsets (CF_HTML spec requirement)

### 3. 🔴 Memory Leak - Script Tags
**File:** `content-script.js:115-121`
**Fix:** Remove script tag after MathJax loads: `script.remove()`

### 4. 🟠 XSS Risk - innerHTML with User Content
**File:** `content-script.js:90, 151, 238, 310, 343`
**Fix:** Sanitize HTML or use DOMParser instead of innerHTML

### 5. 🟠 Context Menu Not Created on Reload
**File:** `background.js:1-7`
**Fix:** Add `onStartup` listener and error handling

### 6. 🟠 MathJax Race Condition
**File:** `content-script.js:111-129`
**Fix:** Use promise instead of boolean flag, prevent multiple loads

### 7. 🟠 Unhandled Promise Rejections
**File:** `content-script.js:8-14`
**Fix:** Better error handling, prevent unhandled rejections

### 8. 🟡 Regex Edge Cases
**File:** `content-script.js:93-109`
**Fix:** Handle escaped dollars, nested formulas, validate braces

### 9. 🟡 execCommand Deprecated
**File:** `content-script.js:317`
**Fix:** Plan alternative fallback, monitor deprecation

### 10. 🟡 Unbounded Cache Growth
**File:** `content-script.js:154`
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

