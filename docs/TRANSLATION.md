# Translation Features

This document describes the translation capabilities added to the GPT LATEX Ctrl-C Ctrl-V extension.

## Overview

The extension can translate content before copying it to the clipboard when Ctrl-C is pressed (if enabled in settings). Translation respects formulas and code blocks by protecting them from translation unless formula translation is specifically enabled.

## Features

### Translation Services

The extension supports multiple translation services:

1. **Pollinations** (Default) - Free AI translation service
2. **Google Translate** - Requires API key
3. **Microsoft Translator** - Requires API key and region
4. **ChatGPT (OpenAI)** - Requires API key, supports formatting and formula translation
5. **Gemini (Google)** - Requires API key, supports formatting and formula translation
6. **Custom API** - Configurable endpoint, headers, and payload format

### Content Analysis

The extension performs dual content analysis:

1. **Semantic Embeddings (64-d)** - Lightweight hash-based embeddings for thematic understanding
2. **Word Frequency Distribution** - Analysis of word usage patterns, filtering out stop words and focusing on real words

Both analyses are used to provide context to AI translation services for better thematic translation.

### Formula and Code Protection

Formulas and code blocks are automatically anchored (protected) during translation:

- **Formula patterns protected:**
  - MathML elements (`<math>...</math>`)
  - LaTeX placeholders (`<!--COF_TEX_0-->`, etc.)
  - Elements with `data-math` attributes
  - OMML conditional comments

- **Code patterns protected:**
  - Code blocks (`<pre>...</pre>`)
  - Inline code (`<code>...</code>`) when not inside pre blocks

Protected content is restored after translation, preserving original formulas and code.

### Formula Translation

When enabled in settings, formulas can be translated using AI agents only (ChatGPT, Gemini, Pollinations, or Custom API). Google Translate and Microsoft Translator do not support formula translation.

## Configuration

Access the options page via Firefox Add-ons Manager → Extension Options.

### Settings

- **Enable Translation** - Toggle translation feature on/off
- **Translation Service** - Select which service to use
- **Target Languages** - Configure up to 5 target languages
- **Default Language** - Set default target language
- **Translate Formulas** - Enable formula translation (AI agents only)
- **Intercept Ctrl-C** - Enable/disable keyboard shortcut interception

### API Keys

Each translation service (except Pollinations) requires an API key:

- Store API keys securely in the options page
- Keys are stored locally using `browser.storage.local`
- Export/import configuration for backup and restore

## Usage

1. **Configure translation** in the options page
2. **Enable "Intercept Ctrl-C"** to activate translation on copy
3. **Select text** on any webpage
4. **Press Ctrl-C** - Content will be translated (if enabled) before copying
5. **Paste** translated content anywhere

### Bypass Normal Copy

Press **Shift+Ctrl-C** to bypass translation and perform normal copy.

## Privacy

When translation is enabled:
- Selected content is sent to the configured translation service
- API keys are stored locally and never transmitted except to the selected service
- No telemetry or analytics are collected
- See `docs/PRIVACY.md` for full privacy policy

## Limitations

- Translation requires network connectivity
- API rate limits may apply based on the selected service
- Large selections may take longer to translate
- Some services may have character limits

