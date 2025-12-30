# Addon Interface Structural Schema

## Overview

This document describes the complete structural schema of the GPT LATEX Ctrl-C Ctrl-V extension interface, including all UI components, data structures, user interactions, and component relationships.

## Interface Components

### 1. Options Page (`extension/options.html`)

**Access:** Firefox Add-ons Manager → Extension Options

**Purpose:** Full configuration interface for all extension settings

**Structure:**

```
Options Page (options.html)
├── Header
│   └── Title: "GPT LATEX Ctrl-C Ctrl-V - Options"
├── Status Display
│   └── #status (success/error messages)
├── Translation Settings Section
│   ├── Enable Translation Checkbox (#translationEnabled)
│   ├── Translation Service Dropdown (#translationService)
│   │   ├── pollinations: "Pollinations (Free AI)"
│   │   ├── google-free: "Google Translate (Free)"
│   │   ├── google: "Google Translate"
│   │   ├── microsoft-free: "Microsoft Translator (Free)"
│   │   ├── microsoft: "Microsoft Translator"
│   │   ├── chatgpt: "ChatGPT (OpenAI)"
│   │   ├── gemini: "Gemini (Google)"
│   │   └── custom: "Custom API"
│   ├── Translate Formulas Checkbox (#translateFormulas)
│   ├── Default Target Language Dropdown (#defaultLanguage)
│   │   └── 269 languages (from TWP, sorted alphabetically)
│   └── Target Languages (5 dropdowns)
│       ├── #targetLanguage1 (269 languages + "None")
│       ├── #targetLanguage2 (269 languages + "None")
│       ├── #targetLanguage3 (269 languages + "None")
│       ├── #targetLanguage4 (269 languages + "None")
│       └── #targetLanguage5 (269 languages + "None")
├── Keyboard Shortcuts Section
│   └── Intercept Ctrl-C Checkbox (#interceptCopy)
├── API Keys Section
│   ├── Google Section (#googleSection) [hidden by default]
│   │   └── API Key Input (#apiKeyGoogle)
│   ├── Microsoft Section (#microsoftSection) [hidden by default]
│   │   ├── API Key Input (#apiKeyMicrosoft)
│   │   └── Region Input (#microsoftRegion)
│   ├── ChatGPT Section (#chatgptSection) [hidden by default]
│   │   └── API Key Input (#apiKeyChatGPT)
│   ├── Gemini Section (#geminiSection) [hidden by default]
│   │   └── API Key Input (#apiKeyGemini)
│   ├── Pollinations Section (#pollinationsSection) [hidden by default]
│   │   ├── Endpoint Input (#pollinationsEndpoint)
│   │   └── API Key Input (#apiKeyPollinations)
│   └── Custom API Section (#customSection) [hidden by default]
│       ├── Endpoint Input (#customEndpoint)
│       ├── API Key Input (#apiKeyCustom)
│       ├── HTTP Method Dropdown (#customMethod)
│       └── Headers Textarea (#customHeaders)
└── Configuration Management Section
    ├── Save Settings Button (#saveBtn)
    ├── Reset to Defaults Button (#resetBtn)
    ├── Export Configuration Button (#exportBtn)
    └── Import Configuration Button (#importBtn)
        └── Hidden File Input (#importFile)
```

**Behavior:**
- Service visibility: Only the selected service's API key section is shown
- Free services (`google-free`, `microsoft-free`) show no API key section
- Language dropdowns: All contain 269 languages from TWP (sorted alphabetically)
- Auto-save: Manual save required (button click)
- Import/Export: JSON file format

---

### 2. Browser Action Popup (`extension/popup.html`)

**Access:** Click extension icon in browser toolbar

**Purpose:** Quick access to translation settings

**Size:** 400px × ~500px (dynamic height)

**Structure:**

```
Popup (popup.html)
├── Header
│   └── Title: "Translation Settings"
├── Status Display
│   └── #status (success/error messages, auto-hide after 3s)
├── Enable Translation Checkbox (#popupTranslationEnabled)
├── Target Languages Section
│   ├── Label: "Target Languages:"
│   ├── #popupTargetLanguage1 (269 languages + "None")
│   ├── #popupTargetLanguage2 (269 languages + "None")
│   ├── #popupTargetLanguage3 (269 languages + "None")
│   ├── #popupTargetLanguage4 (269 languages + "None")
│   └── #popupTargetLanguage5 (269 languages + "None")
└── Actions Section
    └── Advanced Settings Link (#openOptions)
        └── Opens options page
```

**Behavior:**
- Auto-save: Changes save immediately on toggle/selection change
- Language dropdowns: Populated dynamically from embedded LANGUAGE_OPTIONS constant
- Status messages: Auto-hide after 3 seconds
- Link to options: Opens full options page in new tab

---

### 3. Content Script UI (`extension/lib/cof-ui.js`)

**Access:** Injected into web pages

**Purpose:** Toast notifications for user feedback

**Structure:**

```
Content Script UI
└── Toast Notification (#__cof_toast)
    ├── Position: Fixed (bottom-right)
    ├── Style: Dark background (#111827), white text
    ├── Error Style: Red background (#7f1d1d)
    └── Auto-hide: 3 seconds (configurable via CONFIG.NOTIFICATION_DURATION)
```

**Usage:**
- Success messages: "Copied to clipboard.", "Translated content copied to clipboard."
- Error messages: "Copy failed.", "Translation failed."

---

### 4. Context Menu

**Access:** Right-click on selected text

**Purpose:** Alternative access to copy functions

**Structure:**

```
Context Menu Items
├── "Copy as Office Format" (gpt-copy-paster)
├── "Copy as Office Format (Markdown selection)" (gpt-copy-paster-from-markdown)
├── "Copy as Markdown" (copy-as-markdown)
└── "Extract selected HTML" (extract-selected-html)
```

**Behavior:**
- Only visible when text is selected
- Sends messages to content script
- Triggers same functions as keyboard shortcuts

---

## Data Structures

### Configuration Schema (`extension/lib/cof-storage.js`)

```javascript
{
  translation: {
    enabled: boolean,              // Translation feature enabled
    service: string,               // "pollinations" | "google-free" | "google" | 
                                   // "microsoft-free" | "microsoft" | "chatgpt" | 
                                   // "gemini" | "custom"
    targetLanguages: [string, string, string, string, string],  // 5 language codes
    translateFormulas: boolean,    // Enable formula translation (AI only)
    defaultLanguage: string         // Default target language code
  },
  keyboard: {
    interceptCopy: boolean         // Intercept Ctrl-C for translation
  },
  apiKeys: {
    google: string,                // Google Translate API key
    microsoft: string,             // Microsoft Translator API key
    chatgpt: string,               // OpenAI API key
    gemini: string,                // Google Gemini API key
    pollinations: string,          // Pollinations API key (optional)
    custom: string                 // Custom API key
  },
  customApi: {
    endpoint: string,               // API endpoint URL
    headers: object,               // Custom HTTP headers (JSON)
    method: string,                // "POST" | "GET" | "PUT"
    region: string                 // Microsoft Translator region (e.g., "eastus")
  },
  backup: {
    version: string,               // Config version ("1.0.0")
    timestamp: number              // Last modified timestamp
  }
}
```

**Default Values:**
```javascript
{
  translation: {
    enabled: false,
    service: "pollinations",
    targetLanguages: ["", "", "", "", ""],
    translateFormulas: false,
    defaultLanguage: "en"
  },
  keyboard: {
    interceptCopy: false
  },
  apiKeys: {
    google: "",
    microsoft: "",
    chatgpt: "",
    gemini: "",
    pollinations: "",
    custom: ""
  },
  customApi: {
    endpoint: "",
    headers: {},
    method: "POST",
    region: ""
  }
}
```

---

## Language List Structure

### Source: TWP (`TWP/extra/out/final.json`)

**Format:**
```json
{
  "en": {
    "aa": "Afar",
    "ab": "Abkhaz",
    "ace": "Acehnese",
    ...
    "zu": "Zulu"
  }
}
```

**Total Languages:** 269

**Usage:**
- Extracted via `tools/extract_twp_languages.py`
- Sorted alphabetically by English name
- Used in all language dropdowns (options page + popup)
- Language codes match TWP format (may differ from some API expectations)

---

## User Interaction Flows

### Flow 1: Configure Translation (Options Page)

```
User opens Options Page
  ↓
Load Settings (loadSettings())
  ├── Read config from storage
  ├── Populate all form fields
  └── Show/hide API key sections based on selected service
  ↓
User modifies settings
  ├── Select translation service → Show/hide API key section
  ├── Enable/disable translation
  ├── Select languages
  └── Enter API keys
  ↓
User clicks "Save Settings"
  ↓
Save Settings (saveSettings())
  ├── Collect all form values
  ├── Validate structure
  ├── Write to storage
  └── Show success/error message
```

### Flow 2: Quick Configuration (Popup)

```
User clicks extension icon
  ↓
Popup opens
  ├── Load current config
  ├── Populate language dropdowns (269 languages)
  └── Set current values
  ↓
User toggles/changes settings
  ├── Checkbox change → Auto-save
  ├── Language selection change → Auto-save
  └── Show status message (3s)
  ↓
User clicks "Advanced Settings"
  ↓
Options page opens in new tab
```

### Flow 3: Translation on Copy

```
User selects text and presses Ctrl-C
  ↓
Copy Interception (handleCopyInterception)
  ├── Check: interceptCopy enabled?
  ├── Check: translation enabled?
  └── Prevent default copy
  ↓
Translation Pipeline (handleCopyWithTranslation)
  ├── Get selection HTML/text
  ├── Anchor formulas and code blocks
  ├── Analyze content (embeddings + frequency)
  ├── Translate content
  │   ├── Select service based on config
  │   ├── Use free endpoint if service is *-free
  │   └── Use API key if provided for paid services
  ├── Restore anchors
  ├── Translate formulas (if enabled + AI service)
  ├── Process through WASM pipeline
  ├── Convert MathML to OMML (XSLT)
  └── Write to clipboard
  ↓
Show toast notification
```

---

## Service Visibility Logic

**Function:** `updateServiceVisibility(service)` in `options.js`

**Mapping:**
```javascript
{
  "google-free": null,           // No API key section
  "google": #googleSection,      // Show Google API key
  "microsoft-free": null,        // No API key section
  "microsoft": #microsoftSection, // Show Microsoft API key + region
  "chatgpt": #chatgptSection,   // Show ChatGPT API key
  "gemini": #geminiSection,      // Show Gemini API key
  "pollinations": #pollinationsSection, // Show Pollinations endpoint + key
  "custom": #customSection       // Show Custom API config
}
```

**Behavior:**
- Only one section visible at a time
- Free services show no API key section
- Paid services require API keys (validated in translation logic)

---

## Translation Service Routing

**Function:** `translate()` in `cof-translate.js`

**Service Routing:**

```
service === "google-free"
  → translateWithGoogleFree() [no API key]

service === "google"
  → apiKey ? translateWithGoogle() : translateWithGoogleFree()

service === "microsoft-free"
  → translateWithMicrosoftFree() [no API key]

service === "microsoft"
  → apiKey ? translateWithMicrosoft() : translateWithMicrosoftFree()

service === "chatgpt"
  → translateWithChatGPT() [requires API key]

service === "gemini"
  → translateWithGemini() [requires API key]

service === "pollinations"
  → translateWithPollinations() [optional API key]

service === "custom"
  → translateWithCustomAPI() [requires config]
```

**API Key Validation:**
- Free services (`google-free`, `microsoft-free`, `pollinations`): No API key required
- Paid services (`google`, `microsoft`, `chatgpt`, `gemini`, `custom`): API key required (except `google`/`microsoft` fallback to free if no key)

---

## Component Dependencies

```
options.html
  ├── lib/cof-core.js (browser API abstraction)
  ├── lib/cof-storage.js (config management)
  └── options.js (UI logic)

popup.html
  ├── lib/cof-core.js (browser API abstraction)
  ├── lib/cof-storage.js (config management)
  └── popup.js (UI logic)

content-script.js
  ├── lib/cof-storage.js (read config)
  ├── lib/cof-anchor.js (formula/code protection)
  ├── lib/cof-analysis.js (content analysis)
  ├── lib/cof-translate.js (translation)
  └── lib/cof-ui.js (toast notifications)
```

---

## Storage Access Patterns

### Read Pattern
```javascript
const config = await storage.getConfig();
// Returns merged config with defaults
```

### Write Pattern
```javascript
const success = await storage.setConfig(config);
// Validates and saves, returns boolean
```

### Export Pattern
```javascript
const json = await storage.exportConfig();
// Returns JSON string with backup metadata
```

### Import Pattern
```javascript
const success = await storage.importConfig(jsonString);
// Validates and imports, returns boolean
```

---

## Language Selection Interface

### Options Page
- **Default Language:** Single dropdown, 269 languages, no "None" option
- **Target Languages:** 5 separate dropdowns, each with 269 languages + "None" option

### Popup
- **Target Languages:** 5 separate dropdowns, each with 269 languages + "None" option
- **No Default Language:** Uses defaultLanguage from config (not editable in popup)

### Language Code Format
- Standard ISO codes: `en`, `es`, `fr`, `de`, etc.
- Extended codes: `zh-CN`, `zh-TW`, `pt-PT`, `fr-CA`
- Special codes: `emj` (Emoji), `sjn` (Elvish), `tlh-Latn` (Klingon), etc.
- Total: 269 unique language codes

---

## Event Handlers

### Options Page (`options.js`)

```javascript
DOMContentLoaded
  → loadSettings()

#saveBtn.click
  → saveSettings()

#resetBtn.click
  → resetSettings()

#exportBtn.click
  → exportSettings()

#importBtn.click
  → #importFile.click()

#importFile.change
  → importSettings(file)

#translationService.change
  → updateServiceVisibility(service)
```

### Popup (`popup.js`)

```javascript
DOMContentLoaded
  ├── populateLanguageDropdowns()
  └── loadSettings()

#popupTranslationEnabled.change
  → saveSettings()

#popupTargetLanguage[1-5].change
  → saveSettings()

#openOptions.click
  → browserApi.runtime.openOptionsPage()
```

### Content Script (`content-script.js`)

```javascript
keydown (Ctrl-C / Cmd-C)
  → handleCopyInterception(event)
    └── handleCopyWithTranslation()

runtime.onMessage
  ├── "COPY_OFFICE_FORMAT"
  ├── "COPY_AS_MARKDOWN"
  └── "EXTRACT_SELECTED_HTML"
```

---

## UI State Management

### Options Page State
- **Loaded:** Config read from storage on page load
- **Modified:** User changes form fields (not auto-saved)
- **Saved:** Config written to storage on button click
- **Service Visibility:** Updated on service dropdown change

### Popup State
- **Loaded:** Config read from storage on popup open
- **Auto-save:** Changes saved immediately on any modification
- **Status:** Temporary messages (3s display)

### Content Script State
- **Config Cache:** Read on copy interception
- **Translation State:** Per-copy operation (no persistent state)

---

## Error Handling

### Options Page
- **Load Error:** Show error status message
- **Save Error:** Show error status message
- **Import Error:** Show error status message, validate JSON format

### Popup
- **Load Error:** Show error status message
- **Save Error:** Show error status message
- **Auto-hide:** All status messages disappear after 3 seconds

### Content Script
- **Translation Error:** Show error toast, fallback to normal copy
- **Copy Error:** Show error toast, attempt fallback

---

## Accessibility Considerations

### Options Page
- Semantic HTML structure
- Labels associated with inputs
- Keyboard navigation supported
- Status messages visible

### Popup
- Compact design for quick access
- Clear labels
- Keyboard accessible dropdowns
- Status feedback

### Content Script
- Non-intrusive toast notifications
- No blocking UI elements
- Preserves page functionality

---

## File Structure Summary

```
extension/
├── options.html          # Full options page UI
├── options.js           # Options page logic
├── popup.html           # Browser action popup UI
├── popup.js             # Popup logic
├── manifest.json        # Extension manifest (includes browser_action)
└── lib/
    ├── cof-storage.js   # Configuration storage module
    ├── cof-ui.js        # Toast notification UI
    ├── cof-translate.js # Translation service routing
    └── ...
```

---

## Configuration Persistence

**Storage Backend:** `browser.storage.local`

**Storage Key:** `"gptLatexCtrlCVConfig"`

**Persistence:**
- Survives extension reload
- Survives browser restart
- Exportable/importable as JSON
- Versioned (backup.version, backup.timestamp)

**Sync Behavior:**
- Options page ↔ Popup: Shared storage, changes visible immediately
- Content script: Reads config on each operation (no caching)

---

## Summary

The extension interface consists of:

1. **Options Page:** Full-featured configuration interface with all settings
2. **Browser Action Popup:** Quick-access interface for common settings
3. **Content Script UI:** Toast notifications for user feedback
4. **Context Menu:** Alternative access to copy functions

All interfaces share the same configuration storage and maintain consistency through the `cof-storage.js` module. Language selection is unified across all interfaces with 269 languages from TWP.

