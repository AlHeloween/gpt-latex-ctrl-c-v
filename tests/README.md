# Test Files for "Copy as Office Format" Extension

## Files

- **`gemini-conversation-test.html`** - Test HTML file simulating a Gemini conversation with various LaTeX formulas
- **`TEST_INSTRUCTIONS.md`** - Detailed testing procedure and verification checklist
- **`test_extension.py`** - Automated tests using Playwright (requires uv with Playwright installed)
- **`README_TESTING.md`** - Automated testing documentation
- **`uv_setup.md`** - UV-specific setup instructions

## Quick Start

1. Open `gemini-conversation-test.html` in Firefox
2. Select a portion of the conversation (with formulas)
3. Right-click → "Copy as Office Format"
4. Paste into Microsoft Word
5. Save as DOCX and verify formulas are converted correctly

## Test Content

The test file contains 10 message pairs with formulas including:
- Quadratic formula
- Pythagorean theorem
- Euler's identity
- Derivatives and integrals
- Binomial theorem
- Matrix operations
- Limit definitions
- Compound interest

All formulas use standard LaTeX notation:
- Inline: `$formula$`
- Display: `\[formula\]`

## Expected Behavior

When copied and pasted into Microsoft Word:
- ✅ Formulas convert to editable Office equations (OMML)
- ✅ HTML formatting is preserved
- ✅ Plain text remains intact
- ✅ Formulas render correctly in DOCX format

## Troubleshooting

See `TEST_INSTRUCTIONS.md` for detailed troubleshooting steps.

