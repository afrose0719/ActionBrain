import { sendToInbox } from "./api.js";

const MENU_ID = "send-to-actionbrain";

// Menus must be created when the extension is installed or updated.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Send to ActionBrain",
    contexts: ["selection"],
  });
});

function notify(title, message) {
  chrome.notifications.create({ type: "basic", iconUrl: "icons/icon128.png", title, message });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return;

  const result = await sendToInbox(info.selectionText, { title: tab?.title, url: tab?.url });
  if (result.ok) {
    chrome.action.setBadgeBackgroundColor({ color: "#16a34a" });
    chrome.action.setBadgeText({ text: "✓" });
    setTimeout(() => chrome.action.setBadgeText({ text: "" }), 3000);
    notify("Sent to ActionBrain", "Open your Inbox and click “Analyze with AI”.");
  } else {
    notify("ActionBrain could not save that", result.error);
  }
});
