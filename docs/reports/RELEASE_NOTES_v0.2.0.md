# Release Notes - Version 0.2.0

## Overview

Version 0.2.0 introduces translation-on-copy, an icon popup for quick translation settings, and a deterministic copy pipeline for Office-friendly HTML plus real Word equations (MathML → OMML on paste).

## New Features

### Translation on Copy
- **Copy as Office Format + Translate**: Translate selected HTML before converting to Office HTML.
- **Translation on Ctrl-C (optional)**: Intercept Ctrl-C (when enabled) and run the same deterministic translation pipeline.
- **Multiple Translation Services**:
  - Pollinations (Free AI) - default; no API key required (legacy endpoint; serialized requests; aggressive chunking)
  - Google Translate (Free) - web endpoint; no API key required (chunked; POST avoids URL 413)
  - Google Translate (Paid) - API key required
  - Microsoft Translator (Free) - web endpoint; no API key required (Edge token + api-edge translate)
  - Microsoft Translator (Paid) - API key required
  - ChatGPT (OpenAI) - API key required
  - Gemini (Google) - API key required (v1beta preferred; fallback to v1 to avoid “model not found” 404)
  - Custom API - configurable endpoint/method/headers/payload

### Content Protection
- **Formula Anchoring**: Automatically protects LaTeX/MathML formulas from translation
- **Code Block Protection**: Preserves code blocks during translation
- **Smart Restoration**: Formulas and code are restored after translation completes

### Progress + Debugging
- Deterministic progress signals per chunk (stage + progress JSON stored in DOM dataset keys and logged via `[GPT LATEX Ctrl-C Ctrl-V] translationDebug ...`).
- Fail-open behavior for Office copy: if translation fails, the original selection is still copied.

### Content Analysis
- **Semantic Embeddings**: Analyzes content for better translation context
- **Word Frequency Analysis**: Identifies important terms for translation quality
- **Formula/Code Detection**: Automatically detects and protects technical content

### Browser Action Popup
- **Quick Access**: Click extension icon for instant translation settings
- **Enable/Disable Toggle**: Quickly turn translation on/off
- **5 Target Languages**: Select up to 5 target languages directly from popup (English is default)
- **Advanced Settings Link**: Direct access to full options page

### Language Support
- **Language list UI**: Easy-to-navigate dropdowns and 5 favorite languages in the popup
- **Multiple Target Languages**: Support for translating to up to 5 languages simultaneously
- **Default Language**: Configurable default target language

### Enhanced Options Page
- **Service Selection**: Choose from 8 translation services
- **API Key Management**: Secure storage for API keys
- **Service-Specific Configuration**: 
  - Google/Microsoft: Region settings
  - Pollinations: Custom endpoint configuration
  - Custom API: Full HTTP method, headers, and endpoint configuration
- **Import/Export**: Backup and restore configuration
- **Formula Translation**: Option to translate formulas (AI services only)
- **Debug logs toggle**: Enable/disable debug logs (default is off)

## Improvements

### User Interface
- **Status Messages**: Clear feedback for all operations
- **Auto-save**: Popup changes save immediately
- **Service Visibility**: API key sections show/hide based on selected service
- **Free Service Indicators**: Clear labeling of free vs. paid services

### Configuration Management
- **Persistent Storage**: Settings persist across browser sessions
- **Version Tracking**: Configuration includes version and timestamp
- **Validation**: Input validation for all configuration fields

### Code Quality
- **Modular Architecture**: Translation features organized into separate modules
- **Error Handling**: Comprehensive error handling with user-friendly messages
- **Security**: Secure API key storage using browser storage API

## Technical Details

### New Modules
- `lib/cof-storage.js`: Configuration storage and management
- `lib/cof-anchor.js`: Formula and code anchoring system
- `lib/cof-analysis.js`: Content analysis (embeddings, frequency)
- `lib/cof-translate.js`: Translation service routing and execution

### Files Added
- `popup.html`: Browser action popup UI
- `popup.js`: Popup logic and event handlers
- `options.html`: Enhanced with translation settings
- `options.js`: Updated with translation configuration logic

### Dependencies
- Uses free web endpoints for Google and Microsoft translation (TWP approach)
- Supports standard translation APIs (OpenAI, Google Gemini)
- Custom API support for enterprise/self-hosted solutions

### Clipboard accuracy
- “Copy selection HTML” writes the selected HTML fragment as `text/html` exactly (no Office wrappers, no normalization).
- Office copy ensures both `text/html` and `text/plain` are consistent (plain-text paste targets receive translated text when translation is enabled).

## Browser Compatibility

### Firefox
- **Minimum Version**: Firefox 142.0
- **Manifest Version**: 2
- **Format**: XPI (ZIP)

### Chromium (Chrome, Edge, etc.)
- **Manifest Version**: 3
- **Format**: Unpacked extension directory / ZIP bundle
- **Status**: Translation pipeline is wired and covered by automated Chromium extension tests

## Installation

### Firefox
1. Download `dist/gpt-latex-ctrl-c-v.xpi`
2. Open Firefox → Add-ons → Extensions
3. Click the gear icon → Install Add-on From File
4. Select the XPI file

### Chromium
1. Download and extract `dist/chromium/`
2. Open Chrome/Edge → Extensions → Developer mode
3. Click "Load unpacked"
4. Select the `dist/chromium/` directory

## Configuration

### Quick Start (Popup)
1. Click the extension icon
2. Enable translation checkbox
3. Select target languages (up to 5)
4. Start copying with Ctrl-C

### Advanced Configuration (Options Page)
1. Right-click extension icon → Options
2. Select translation service
3. Configure API keys (if using paid services)
4. Set default language and target languages
5. Enable "Intercept Ctrl-C" for automatic translation

## Known Limitations

- **Formula Translation**: Only available with AI services (ChatGPT, Gemini, Pollinations)
- **Free Services**: Pollinations/Google/Microsoft free endpoints can be rate-limited
- **Language Codes**: Some language codes may need conversion for specific APIs

## Migration from Previous Versions

- **Settings**: Existing settings are preserved
- **New Features**: Translation is disabled by default
- **API Keys**: Must be configured in Options page for paid services

## Documentation

- **Interface Schema**: See `docs/INTERFACE_SCHEMA.md` for complete UI structure
- **Translation Guide**: See `docs/TRANSLATION.md` for translation features
- **Architecture**: See `docs/ARCHITECTURE.md` for technical details

## Credits

- **Language List**: Based on TWP (Translate Web Pages) extension
- **Free Translation Endpoints**: Inspired by TWP's approach to free translation services

## Support

- **GitHub**: https://github.com/alheloween/gpt-latex-ctrl-c-v
- **Issues**: Report bugs and feature requests on GitHub
- **Privacy Policy**: See `docs/PRIVACY.md`

---

**Version**: 0.2.0  
**Release Date**: 2026-01-06  
**Build**: Firefox XPI + Chromium (MV3) bundle/zip

