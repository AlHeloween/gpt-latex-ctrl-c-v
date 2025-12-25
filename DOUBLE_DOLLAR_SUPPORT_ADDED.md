# Double Dollar ($$...$$) Display Math Support Added

## Issue

The extension was not detecting or converting `$$...$$` (double dollar) display math formulas. When users pasted formulas like:

```
$$s_{ij} = \langle \text{Vec}(\mathcal{Q}_i), \text{Vec}(\mathcal{K}_j) \rangle_{\mathbb{R}^8}$$
```

They were pasted as plain text instead of being converted to Office Math format.

## Root Cause

The LaTeX detection regex patterns only supported:
- `$...$` (single dollar inline math)
- `\[...\]` (display math brackets)
- `\(...\)` (inline math parentheses)
- `\begin{...}...\end{...}` (environments)

But **NOT** `$$...$$` (double dollar display math), which is a common LaTeX format.

## Fix Applied

### 1. Updated `extractLatex()` function
- Added pattern for `$$...$$` (must be checked BEFORE `$...$` to avoid partial matches)
- Updated extraction logic to handle double dollar signs
- Pattern order: `$$...$$` → `\[...\]` → `\(...\)` → `$...$` → environments

### 2. Updated `convertLatexInHtml()` function
- Added `$$` check to regex pattern (before `$` check)
- Updated detection logic to identify `$$...$$` formulas
- Added `isDisplay` flag to track display vs inline math
- Updated cache key to include display mode

### 3. Updated MathJax conversion
- `latexToMathml()` now accepts `display` parameter
- `$$...$$` formulas are converted with `display: true`
- `$...$` formulas are converted with `display: false`

### 4. Updated plain text processing
- Added detection for `$$...$$` in plain text selections
- Determines display mode based on original delimiters

## Code Changes

### Pattern Order (Important!)
```javascript
const patterns = [
  /(?<!\\)\$\$(.+?)(?<!\\)\$\$/g,  // Display: $$...$$ (check FIRST!)
  /\\\[.*?\\\]/g,                   // Display: \[...\]
  /\\\(.*?\\\)/g,                   // Inline: \(...\)
  /(?<!\\)\$(.+?)(?<!\\)\$/g,      // Inline: $...$ (check AFTER $$)
  /\\begin\{(\w+)\}[\s\S]*?\\end\{\1\}/g
];
```

### Display Mode Detection
```javascript
if (raw.startsWith("$$")) {
  latex = raw.slice(2, -2).trim();
  isDisplay = true;  // Mark as display math
}
```

## Testing

To test the fix:

1. **Reload extension** via `about:debugging`
2. **Select text** containing `$$...$$` formulas
3. **Right-click → "Copy as Office Format"**
4. **Paste into Microsoft Word**
5. **Verify** formulas are converted to Office Math format

## Example

**Input:**
```
$$s_{ij} = \langle \text{Vec}(\mathcal{Q}_i), \text{Vec}(\mathcal{K}_j) \rangle_{\mathbb{R}^8}$$
```

**Expected Output:**
- Formula converted to OMML (Office Math Markup Language)
- Renders correctly in Microsoft Word
- Not pasted as plain text

## Notes

- `$$...$$` is now treated as **display math** (like `\[...\]`)
- `$...$` remains **inline math** (like `\(...\)`)
- Pattern order is critical - `$$` must be checked before `$`
- Display mode affects MathJax rendering and spacing

