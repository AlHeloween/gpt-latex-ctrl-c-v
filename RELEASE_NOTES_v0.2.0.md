# Release Notes - Version 0.2.0

## Overview

Version 0.2.0 introduces comprehensive translation capabilities, enhanced UI with browser action popup, and full language support with 269 languages from TWP (Translate Web Pages).

## New Features

### Translation on Copy
- **Translation on Ctrl-C**: Automatically translate selected content before copying to clipboard
- **Multiple Translation Services**: Support for 8 different translation services:
  - Pollinations (Free AI) - Default, no API key required
  - Google Translate (Free) - Web endpoint, no API key required
  - Google Translate (Paid) - API key required
  - Microsoft Translator (Free) - Web endpoint, no API key required
  - Microsoft Translator (Paid) - API key required
  - ChatGPT (OpenAI) - API key required
  - Gemini (Google) - API key required
  - Custom API - Fully configurable endpoint

### Content Protection
- **Formula Anchoring**: Automatically protects LaTeX/MathML formulas from translation
- **Code Block Protection**: Preserves code blocks during translation
- **Smart Restoration**: Formulas and code are restored after translation completes

### Content Analysis
- **Semantic Embeddings**: Analyzes content for better translation context
- **Word Frequency Analysis**: Identifies important terms for translation quality
- **Formula/Code Detection**: Automatically detects and protects technical content

### Browser Action Popup
- **Quick Access**: Click extension icon for instant translation settings
- **Enable/Disable Toggle**: Quickly turn translation on/off
- **5 Target Languages**: Select up to 5 target languages directly from popup
- **Advanced Settings Link**: Direct access to full options page

### Language Support
- **269 Languages**: Full language list from TWP (Translate Web Pages)
- **Alphabetical Sorting**: Easy-to-navigate language dropdowns
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

## Browser Compatibility

### Firefox
- **Minimum Version**: Firefox 142.0
- **Manifest Version**: 2
- **Format**: XPI (ZIP)

### Chromium (Chrome, Edge, etc.)
- **Manifest Version**: 3
- **Format**: Unpacked extension directory
- **Note**: Translation features require additional testing on Chromium

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

- **Chromium Translation**: Translation features may require additional testing on Chromium-based browsers
- **Formula Translation**: Only available with AI services (ChatGPT, Gemini, Pollinations)
- **Free Services**: Google/Microsoft free endpoints may have rate limits
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
**Release Date**: 2025-01-XX  
**Build**: Firefox XPI + Chromium Extension

