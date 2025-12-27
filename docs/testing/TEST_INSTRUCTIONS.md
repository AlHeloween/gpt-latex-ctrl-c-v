# Test Instructions for "Copy as Office Format" Extension

## Overview
This test verifies that the extension correctly converts LaTeX formulas to OMML format when copying browser selections to the clipboard.

## Test Files
- **Primary**: `gemini-conversation-test.html` - Simulated Gemini conversation with 10 message pairs containing various LaTeX formulas
- **Alternative**: You can also use real saved Gemini pages (e.g., `test_example/Google Gemini.htm`) - just open the saved HTML file in Firefox and test with actual Gemini content

## Test Procedure

### Step 1: Load the Test File
1. Open Firefox browser
2. Load the test file: `file:///path/to/examples/gemini-conversation-test.html`
   - Or drag and drop the HTML file into Firefox
   - Or use `Ctrl+O` (Cmd+O on Mac) to open the file

### Step 2: Install/Reload Extension
1. Make sure the extension is installed in Firefox
2. If you made changes, reload the extension:
   - Go to `about:debugging`
   - Click "This Firefox"
   - Find "Copy as Office Format"
   - Click "Reload"

### Step 3: Select and Copy
1. Select a portion of the conversation (e.g., 2-3 message pairs with formulas)
2. Right-click on the selection
3. Choose "Copy as Office Format" from the context menu
4. Check the browser console (F12) for confirmation message: `[Copy as Office Format] Copied to clipboard in Office format.`

### Step 4: Verify in Microsoft Word
1. Open Microsoft Word (or LibreOffice Writer)
2. Paste the content (Ctrl+V or Cmd+V)
3. Verify:
   - **Text formatting is preserved** (colors, structure)
   - **LaTeX formulas are converted to editable equations**
   - **Formulas render correctly** (not as raw LaTeX)
   - **Inline formulas** ($...$) appear inline with text
   - **Display formulas** (\[...\]) appear as centered equations

### Step 5: Save as DOCX
1. In Word: File → Save As → Choose "Word Document (*.docx)"
2. Save the file (e.g., `test-output.docx`)
3. Close and reopen the DOCX file to verify formulas persist

## Expected Results

### Formulas to Test
The test file includes these formula types:

1. **Quadratic formula**: `\[x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}\]`
2. **Pythagorean theorem**: `\[a^2 + b^2 = c^2\]`
3. **Euler's identity**: `\[e^{i\pi} + 1 = 0\]`
4. **Derivative**: `\[f'(x) = 3x^2\]`
5. **Integral**: `\[\int \sin(x) \, dx = -\cos(x) + C\]`
6. **Binomial theorem**: `\[(a + b)^n = \sum_{k=0}^{n} \binom{n}{k} a^{n-k} b^k\]`
7. **Matrix multiplication**: `\[c_{ij} = \sum_{k=1}^{n} a_{ik} b_{kj}\]`
8. **Limit definition**: `\[\forall \epsilon > 0, \exists \delta > 0 : |x - a| < \delta \implies |f(x) - L| < \epsilon\]`
9. **Compound interest**: `\[A = P\left(1 + \frac{r}{n}\right)^{nt}\]`

### Verification Checklist
- [ ] All formulas convert to editable Office equations (not plain text)
- [ ] Inline formulas ($...$) appear inline with surrounding text
- [ ] Display formulas (\[...\]) appear as centered equations
- [ ] Fractions render correctly
- [ ] Superscripts and subscripts work
- [ ] Greek letters (π, ε, δ) display correctly
- [ ] Special symbols (∑, ∫, ±, √) render properly
- [ ] HTML formatting (colors, structure) is preserved
- [ ] Plain text content is intact
- [ ] DOCX file opens correctly after saving

## Troubleshooting

### Formulas Not Converting
- Check browser console for errors
- Verify MathJax library loads (check Network tab)
- Ensure XSLT file is accessible

### Formulas Appear as Raw LaTeX
- Check that OMML conversion succeeded (console logs)
- Verify Office application supports OMML (Word 2007+)
- Try pasting into a new Word document

### Formatting Lost
- Verify HTML structure is preserved in selection
- Check CF_HTML format is correct (byte offsets)
- Try selecting smaller portions

### Extension Not Appearing
- Verify extension is enabled in `about:debugging`
- Check manifest.json permissions
- Reload the extension

## Test Variations

### Test 1: Single Formula
- Select just one formula (e.g., the quadratic formula)
- Copy and verify it converts correctly

### Test 2: Mixed Content
- Select text with both inline ($x^2$) and display (\[...\]) formulas
- Verify both types convert correctly

### Test 3: Multiple Formulas
- Select 3-4 message pairs with various formulas
- Verify all formulas convert in a single copy operation

### Test 4: Plain Text Only
- Select text without formulas
- Verify plain text copies correctly with formatting

### Test 5: Edge Cases
- Select across multiple message elements
- Select partial formulas (should handle gracefully)
- Select code blocks (formulas in code should be excluded)

## Notes
- The extension works on any website, not just Gemini
- Formulas in CODE, PRE, KBD, SAMP, TEXTAREA elements are excluded from conversion
- The extension uses CF_HTML format for Office compatibility
- Fallback mechanisms ensure content is always copied (even if conversion fails)

