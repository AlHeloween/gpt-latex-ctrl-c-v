browser.runtime.onInstalled.addListener(() => {
  browser.contextMenus.create({
    id: "export-chat-html",
    title: "Copy chat → Rich HTML",
    contexts: ["page", "selection"]
  });
  browser.contextMenus.create({
    id: "export-selection-html",
    title: "Copy selection → Rich HTML",
    contexts: ["selection"]
  });
  browser.contextMenus.create({
    id: "save-chat-html",
    title: "Save chat → HTML file",
    contexts: ["page", "selection"]
  });
});

browser.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "export-chat-html") {
    browser.tabs.sendMessage(tab.id, { type: "EXPORT_CHAT", mode: "copy" }).catch((err) => {
      console.warn("Cannot send EXPORT_CHAT", err);
    });
  } else if (info.menuItemId === "export-selection-html") {
    browser.tabs.sendMessage(tab.id, { type: "EXPORT_CHAT", mode: "copy-selection" }).catch((err) => {
      console.warn("Cannot send EXPORT_CHAT selection", err);
    });
  } else if (info.menuItemId === "save-chat-html") {
    browser.tabs.sendMessage(tab.id, { type: "EXPORT_CHAT", mode: "save" }).catch((err) => {
      console.warn("Cannot send EXPORT_CHAT save", err);
    });
  }
});

browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "SAVE_FILE" && msg.filename && msg.data) {
    const blob = new Blob([msg.data], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    browser.downloads.download({
      url,
      filename: msg.filename,
      saveAs: true
    }).then((id) => {
      // Revoke URL after a short delay to allow download to start.
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      sendResponse({ ok: true, downloadId: id });
    }).catch((err) => {
      console.error("Download failed", err);
      sendResponse({ ok: false, error: err.toString() });
    });
    return true; // keep the message channel open for async sendResponse
  }
});
