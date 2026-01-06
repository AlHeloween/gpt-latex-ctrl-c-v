# Manual Verification Guide for AMO Submission

This guide provides step-by-step instructions for manually verifying the extension before submitting to AMO.

## Prerequisites

1. Firefox browser installed (version 142.0 or later)
2. Microsoft Word installed (for paste verification)
3. Extension XPI file: `dist/gpt-latex-ctrl-c-v.xpi`

## Step 1: Load Extension

1. Open Firefox
2. Navigate to `about:debugging`
3. Click "This Firefox" in the left sidebar
4. Click "Load Temporary Add-on..."
5. Navigate to the project directory and select `extension/manifest.json`
6. Verify the extension appears in the list with ID: `gpt-latex-ctrl-c-v@example`

## Step 2: Test Basic Copy Functionality

### Test 1: Copy from Gemini Conversation

1. Open `examples/gemini-conversation-test.html` in Firefox
2. Select some text (e.g., a user query or message)
3. Right-click and select "Copy as Office Format"
4. Open Microsoft Word
5. Paste (Ctrl+V)
6. **Verify**: 
   - Text formatting is preserved
   - If formulas are present, they should be editable equations in Word

### Test 2: Copy from Selection Example

1. Open `examples/selection_example_static.html` in Firefox
2. Select content with formulas
3. Right-click and select "Copy as Office Format"
4. Paste into Word
5. **Verify**: 
   - Formulas are editable equations
   - Formatting is preserved

### Test 3: Copy from ChatGPT Example

1. Open `examples/ChatGPT_example.html` in Firefox
2. Select content
3. Right-click and select "Copy as Office Format"
4. Paste into Word
5. **Verify**: 
   - Content pastes correctly
   - Formatting preserved

## Step 3: Test All Copy Modes

### Mode 1: Copy as Office Format (HTML)
- Right-click → "Copy as Office Format"
- Should paste as formatted HTML in Word

### Mode 2: Copy as Office Format (Markdown selection)
- Right-click → "Copy as Office Format (Markdown selection)"
- Should convert markdown to Office HTML

### Mode 3: Copy as Markdown
- Right-click → "Copy as Markdown"
- Should copy as plain markdown text

### Mode 4: Extract Selected HTML
- Right-click → "Extract selected HTML"
- Should copy formatted plain text

## Step 4: Test Translation Features

1. Click the extension icon in the toolbar
2. Enable translation checkbox
3. Select a target language (e.g., Spanish)
4. Select text on a webpage
5. Press Ctrl-C
6. **Verify**: 
   - Content is translated before copying
   - Paste shows translated content
7. Test Shift+Ctrl-C to bypass translation

## Step 5: Test Popup Functionality

1. Click extension icon
2. **Verify**:
   - Enable/disable toggle works
   - Language selection dropdowns work
   - "Advanced Settings" link opens options page

## Step 6: Test Options Page

1. Right-click extension icon → Options
2. **Verify**:
   - Translation service selection works
   - API key fields show/hide based on service
   - Settings save correctly
   - Import/Export works

## Step 7: Test Context Menu

1. Right-click on selected text
2. **Verify** all menu items appear:
   - "Copy as Office Format"
   - "Copy as Office Format (Markdown selection)"
   - "Copy as Markdown"
   - "Extract selected HTML"

## Step 8: Test Formula Conversion

1. Select text containing LaTeX formulas (e.g., `$x^2 + y^2 = z^2$`)
2. Copy as Office Format
3. Paste into Word
4. **Verify**:
   - Formulas appear as editable equations
   - Can double-click to edit in Word's equation editor

## Step 9: Test Error Handling

1. Try copying with no selection
2. **Verify**: Error message appears (toast notification)

## Step 10: Build and Verify XPI

1. Run build command:
   ```bash
   uv run python tools/build_rust_wasm.py
   uv run python tools/build_firefox_xpi.py --out dist/gpt-latex-ctrl-c-v.xpi
   ```

2. **Verify**:
   - XPI file is created
   - File size is reasonable
   - Can be loaded in Firefox

## Checklist

- [ ] Extension loads without errors
- [ ] All copy modes work correctly
- [ ] Formulas convert to editable Word equations
- [ ] Translation feature works
- [ ] Popup functionality works
- [ ] Options page works
- [ ] Context menu appears correctly
- [ ] Error handling works
- [ ] XPI builds successfully
- [ ] No console errors in browser console

## Known Limitations

- Translation requires network connectivity
- Some translation services require API keys
- Word paste verification requires Microsoft Word installed

## Troubleshooting

### Extension not loading
- Check Firefox version (must be 142.0+)
- Check console for errors
- Verify manifest.json is valid

### Copy not working
- Check clipboard permissions
- Verify content script is loaded (check DOM for `data-copy-office-format-extension-loaded="true"`)
- Check browser console for errors

### Formulas not converting
- Verify WASM file is present: `extension/wasm/tex_to_mathml.wasm`
- Check browser console for WASM errors
- Verify XSLT file is present: `extension/assets/mathml2omml.xsl`

## Next Steps After Verification

1. If all tests pass, proceed with AMO submission
2. Upload `dist/gpt-latex-ctrl-c-v.xpi` to AMO
3. Provide privacy policy URL
4. Answer permissions questions
5. Complete submission form
