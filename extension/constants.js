// Extension constants and configuration

const CONFIG = {
  // Cache settings
  CACHE_MAX_SIZE: 100,
  
  // Timeout settings (milliseconds)
  MATHJAX_LOAD_TIMEOUT: 10000,
  LATEX_TO_MATHML_TIMEOUT: 5000,
  LATEX_TO_OMML_TIMEOUT: 8000,
  
  // Performance thresholds
  LARGE_SELECTION_THRESHOLD: 50000, // bytes
  
  // Notification settings
  NOTIFICATION_DURATION: 3000, // milliseconds
  
  // Excluded tags for LaTeX processing
  EXCLUDED_TAGS: ["CODE", "PRE", "KBD", "SAMP", "TEXTAREA"],
  
  // LaTeX patterns
  LATEX_PATTERNS: {
    INLINE_DOLLAR: /(?<!\\)\$(.+?)(?<!\\)\$/g,
    DISPLAY_BRACKETS: /\\\[.*?\\\]/g,
    INLINE_PARENS: /\\\(.*?\\\)/g,
    ENVIRONMENTS: /\\begin\{(\w+)\}[\s\S]*?\\end\{\1\}/g,
    FALLBACK_DOLLAR: /\$(.+?)\$/g
  },
  
  // Messages
  MESSAGES: {
    NO_SELECTION: "No text selected.",
    SELECTION_INVALID: "Selection is invalid. Please select text again.",
    SELECTION_LOST: "Selection was lost during processing. Please select again.",
    COPY_SUCCESS: "Copied to clipboard in Office format.",
    COPY_FAILED: "Copy failed; see console for details.",
    CLIPBOARD_DENIED: "Clipboard access denied. Please check permissions.",
    MATHJAX_LOAD_TIMEOUT: "MathJax load timeout",
    MATHJAX_LOAD_FAILED: "MathJax failed to load",
    XSLT_FETCH_FAILED: "XSLT fetch failed",
    XSLT_PARSE_ERROR: "XSLT parse error",
    MATHML_PARSE_ERROR: "MathML parse error",
    LATEX_CONVERSION_TIMEOUT: "LaTeX conversion timeout",
    XSLT_TRANSFORM_FAILED: "XSLT transformation failed"
  }
};

// Expose for content-script.js (which checks window.CONFIG first).
if (typeof window !== 'undefined') {
  window.CONFIG = CONFIG;
}

// Export for use in content script
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
}

