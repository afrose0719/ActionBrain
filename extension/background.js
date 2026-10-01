import { fetchReminderData, sendToInbox } from "./api.js";
import { planReminders } from "./reminders.js";
import { APP_URL } from "./config.js";

const MENU_ID = "send-to-actionbrain";
const ALARM = "reminders";

function ensureAlarm() {
  chrome.alarms.get(ALARM, (existing) => {
    if (!existing) chrome.alarms.create(ALARM, { delayInMinutes: 1, periodInMinutes: 15 });
  });
}

// Menus must be created when the extension is installed or updated.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Send to ActionBrain",
    contexts: ["selection"],
  });
  ensureAlarm();
});

// Alarms can be cleared when the browser restarts, so make sure it exists again.
chrome.runtime.onStartup.addListener(ensureAlarm);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) runReminders();
});

async function runReminders() {
  const { reminders = true, notified = {} } = await chrome.storage.local.get(["reminders", "notified"]);
  if (!reminders) return;

  let data;
  try {
    data = await fetchReminderData();
  } catch {
    return; // offline or a temporary error: try again at the next alarm
  }
  if (!data) return; // not logged in

  const plan = planReminders({ ...data, now: Date.now(), notified });
  await chrome.storage.local.set({ notified: plan.notified });
  for (const n of plan.notifications) {
    // the page to open when clicked is encoded in the notification id: open:<path>:<key>
    chrome.notifications.create(`open:${n.path}:${n.key}`, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: n.title,
      message: n.message,
      priority: 1,
    });
  }
}

chrome.notifications.onClicked.addListener((id) => {
  if (!id.startsWith("open:")) return;
  chrome.tabs.create({ url: `${APP_URL}${id.split(":")[1]}` });
  chrome.notifications.clear(id);
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
