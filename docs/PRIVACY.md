# Privacy Policy (Draft)

## Summary

"GPT LATEX Ctrl-C Ctrl-V" operates locally to transform your current browser selection into Office-compatible clipboard formats.

## Data collection

- No account creation.
- No telemetry is intentionally collected.
- Translation feature: When translation is enabled, selected content may be sent to third-party translation services (Google Translate, Microsoft Translator, OpenAI ChatGPT, Google Gemini, Pollinations, or custom API endpoints) based on your configuration. Content is only sent when you explicitly copy with translation enabled.
- No copied content is transmitted to remote servers unless translation is enabled and configured by the user.

## Permissions rationale

- `contextMenus`: adds a "Copy as Office Format" context menu entry (extension name: GPT LATEX Ctrl-C Ctrl-V).
- `activeTab`: allows reading the current tab’s selection/DOM when you invoke the action.
- `clipboardWrite`: writes the converted selection to the clipboard.

## Data retention

The extension does not intentionally persist copied content. Test-only bridges (used by automated fixtures) keep the last payload in-memory for verification.

## Contact

For support, bug reports, or questions, please visit:
- **GitHub Issues**: https://github.com/alheloween/gpt-latex-ctrl-c-v/issues
- **Homepage**: https://github.com/alheloween/gpt-latex-ctrl-c-v
