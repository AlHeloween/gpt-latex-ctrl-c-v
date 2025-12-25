# Mozilla Documentation Gaps - Extension Loading

## Summary

This document identifies gaps in Mozilla's documentation for Firefox extension loading, particularly for automated testing scenarios.

## Issues Encountered

### 1. AddonManager API Requirements

**Gap**: Documentation doesn't clearly state that `AddonManager.installTemporaryAddon()` requires XPI files, not directories.

**What We Learned**:
- AddonManager.installTemporaryAddon() **only accepts XPI files**
- Does NOT accept directory paths (even with manifest.json)
- Requires signing/validation for permanent installs
- about:debugging accepts both XPI and directories

**Where This Should Be Documented**:
- [AddonManager API Reference](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API)
- [Extension Development Guide](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions)

**Suggested Documentation Addition**:
```markdown
## installTemporaryAddon()

**Parameters:**
- `file` (FileUtils.File): The extension file to install
  - **Must be an XPI file** (packaged extension)
  - Directory paths are NOT supported
  - For directory-based extensions, use about:debugging interface

**Note**: This method requires XPI files. For unpacked extensions (directories),
use the about:debugging interface instead.
```

### 2. about:debugging vs AddonManager

**Gap**: Clear distinction between when to use about:debugging vs AddonManager is not well documented.

**What We Learned**:
- **about:debugging**: Accepts both XPI and directories, no signing required
- **AddonManager**: Only XPI files, signing required for permanent installs

**Where This Should Be Documented**:
- [about:debugging Documentation](https://firefox-source-docs.mozilla.org/devtools-user/about_colon_debugging/index.html)
- Extension development guides

**Suggested Documentation Addition**:
```markdown
## When to Use What

### about:debugging Interface
- ✅ Accepts XPI files
- ✅ Accepts directory-based extensions (manifest.json)
- ✅ No signing required
- ✅ Perfect for development/testing
- ✅ Temporary (removed on browser restart)

### AddonManager API
- ✅ Accepts XPI files only
- ❌ Does NOT accept directories
- ⚠️ Requires signing for permanent installs
- ✅ Can install temporary addons (if XPI provided)
- ⚠️ More complex, requires privileged context
```

### 3. Automation/Testing Support

**Gap**: Limited documentation on automating extension loading for testing.

**What We Learned**:
- Playwright's `--load-extension` flag loads extension but content scripts may not inject
- about:debugging navigation is problematic in automation tools
- No clear guidance on automated testing workflows

**Where This Should Be Documented**:
- [Extension Testing Guide](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Testing)
- Automation tool documentation

**Suggested Documentation Addition**:
```markdown
## Automated Testing

### Known Limitations

**Playwright/Selenium**:
- `--load-extension` flag may load extension but content scripts may not inject
- about:debugging page navigation may timeout in automation
- Manual loading via about:debugging is most reliable

**Recommended Approach**:
1. Load extension manually via about:debugging
2. Use automation tools to interact with pages (not to load extension)
3. Or package extension as XPI and use AddonManager API

### Best Practices

- For development: Use about:debugging manually
- For CI/CD: Package as XPI, use AddonManager if possible
- For testing: Load manually, then automate page interactions
```

### 4. Content Script Injection Timing

**Gap**: Documentation doesn't clearly explain when content scripts inject and what affects injection.

**What We Learned**:
- Content scripts inject at `document_idle` (as specified in manifest)
- Extension must be "active" for content scripts to inject
- Some automation tools may load extension but not activate it properly

**Where This Should Be Documented**:
- [Content Scripts Guide](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts)
- Extension lifecycle documentation

**Suggested Documentation Addition**:
```markdown
## Content Script Injection

### When Scripts Inject

Content scripts inject based on:
1. Manifest `run_at` setting (default: `document_idle`)
2. Extension must be active/loaded
3. Page must match manifest `matches` patterns

### Common Issues

**Scripts Not Injecting**:
- Extension may be loaded but not active
- Check extension status in about:debugging
- Verify manifest `matches` patterns include target URL
- Check browser console for errors

**Automation Tools**:
- Some tools load extension but don't activate it properly
- Manual loading via about:debugging is most reliable
```

## Recommendations for Mozilla

1. **Clarify AddonManager Requirements**:
   - Clearly state XPI-only requirement
   - Explain difference from about:debugging

2. **Improve Testing Documentation**:
   - Document automation limitations
   - Provide recommended workflows
   - Include troubleshooting guides

3. **Add Examples**:
   - Code examples for both approaches
   - Automation examples
   - Common pitfalls and solutions

4. **Cross-Reference**:
   - Link between AddonManager and about:debugging docs
   - Connect testing guides to loading methods

## Current Workarounds

Until documentation improves, developers can:

1. **Use about:debugging manually** for development
2. **Package as XPI** if using AddonManager API
3. **Load manually, then automate** for testing
4. **Check browser console** for errors and clues
5. **Inspect DOM** to verify extension loaded

## Conclusion

The Firefox extension system works well, but documentation gaps make it difficult for developers to:
- Choose the right loading method
- Understand API requirements
- Set up automated testing
- Troubleshoot loading issues

Better documentation would significantly improve developer experience.

---

**Note**: This document is based on real-world experience developing and testing a Firefox extension. All findings are from actual implementation attempts and testing.

