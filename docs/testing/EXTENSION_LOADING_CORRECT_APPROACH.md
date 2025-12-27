# Correct Extension Loading Approach

## Key Facts

1. **AddonManager.installTemporaryAddon()**:
   - ✅ Requires XPI files (packaged extensions)
   - ❌ Does NOT accept directories
   - ❌ Requires signing/validation for permanent installs
   - ✅ Can install temporary addons if XPI is provided

2. **about:debugging Interface**:
   - ✅ Accepts XPI files
   - ✅ Accepts directories (with `extension/manifest.json`)
   - ✅ No signing required for temporary addons
   - ✅ Perfect for development/testing

## Current Implementation Status

The current implementation incorrectly tries to use AddonManager with directory paths. This needs to be fixed to either:

1. **Option A**: Package extension as XPI first, then use AddonManager
2. **Option B**: Use about:debugging interface (accepts directories directly) ✅ **RECOMMENDED**

## Recommended Approach: about:debugging

Since we have a directory-based extension, the best approach is to use `about:debugging` interface programmatically:

1. Navigate to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on" button
3. Select `extension/manifest.json` via file picker
4. Extension loads automatically

This is what the user does manually, and we can automate it with Playwright.

## Implementation Plan

1. Navigate to about:debugging page
2. Find and click "Load Temporary Add-on" button
3. Handle file picker dialog
4. Select `extension/manifest.json`
5. Wait for extension to load
6. Verify extension is loaded

## Alternative: Package as XPI

If we want to use AddonManager, we need to:
1. Create XPI package from directory
2. Use AddonManager.installTemporaryAddon() with XPI path
3. This is more complex but may be more reliable

## References

- Firefox Source Docs: https://firefox-source-docs.mozilla.org/devtools-user/about_colon_debugging/index.html
- AddonManager API: Requires XPI files only
- about:debugging: Accepts both XPI and directories

