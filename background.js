// Debug mode - set to false in production
const DEBUG = true; // ENABLED FOR TROUBLESHOOTING
const log = DEBUG ? console.log.bind(console, "[Copy as Office Format Background]") : () => {};
const logError = console.error.bind(console, "[Copy as Office Format Background]");

async function createContextMenu() {
  try {
    // Try to remove existing menu first (in case of reload)
    try {
      await browser.contextMenus.remove("copy-office-format");
    } catch (e) {
      // Menu doesn't exist, that's fine
    }
    
    await browser.contextMenus.create({
      id: "copy-office-format",
      title: "Copy as Office Format",
      contexts: ["selection"]
    });
    log("Context menu created");
  } catch (err) {
    logError("Failed to create context menu:", err);
  }
}

browser.runtime.onInstalled.addListener(createContextMenu);
browser.runtime.onStartup.addListener(createContextMenu);

browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "EXTENSION_READY") {
    if (DEBUG) {
      log("Extension ready notification received from content script");
    }
    sendResponse({status: 'ready', version: '0.2.0'});
    return true; // Keep channel open for async response
  }
  return false;
});

browser.contextMenus.onClicked.addListener((info, tab) => {
  log("🔵 Context menu clicked!");
  log("   Menu item ID:", info.menuItemId);
  log("   Tab ID:", tab ? tab.id : "NO TAB");
  log("   Tab URL:", tab ? tab.url : "NO TAB");
  
  if (info.menuItemId === "copy-office-format") {
    // Check if tab is valid before sending message
    if (!tab || !tab.id) {
      logError("❌ Invalid tab - cannot send message");
      return;
    }
    
    log("📤 Sending COPY_OFFICE_FORMAT message to tab", tab.id);
    browser.tabs.sendMessage(tab.id, { type: "COPY_OFFICE_FORMAT" }).then((response) => {
      log("✅ Message sent successfully to tab", tab.id);
      log("   Response:", response);
    }).catch((err) => {
      logError("❌ Cannot send message to tab", tab.id);
      logError("   Error:", err);
      logError("   Error name:", err.name);
      logError("   Error message:", err.message);
      logError("   Possible causes:");
      logError("   - Content script not loaded");
      logError("   - Tab URL not matching manifest patterns");
      logError("   - Extension not active on this page");
    });
  } else {
    log("⚠️ Unknown menu item clicked:", info.menuItemId);
  }
});
