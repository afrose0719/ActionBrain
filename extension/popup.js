import { login, logout, currentUser, sendToInbox } from "./api.js";
import { APP_URL } from "./config.js";

const $ = (id) => document.getElementById(id);

function say(text, kind = "") {
  $("msg").textContent = text;
  $("msg").className = kind;
}

async function render() {
  const email = await currentUser();
  $("login").hidden = !!email;
  $("main").hidden = !email;
  if (email) {
    const { reminders = true } = await chrome.storage.local.get("reminders");
    $("reminders").checked = reminders;
    $("who").textContent = email;
    $("open").href = `${APP_URL}/inbox`;
  }
}

$("login").addEventListener("submit", async (e) => {
  e.preventDefault();
  say("Logging in...");
  try {
    await login($("email").value.trim(), $("password").value);
    $("password").value = "";
    say("");
    render();
  } catch (err) {
    say(err.message, "error");
  }
});

$("send").addEventListener("click", async () => {
  $("send").disabled = true;
  const result = await sendToInbox($("text").value, { title: "Quick capture" });
  $("send").disabled = false;
  if (result.ok) {
    $("text").value = "";
    say("Sent to your Inbox.", "ok");
  } else {
    say(result.error, "error");
  }
});

$("reminders").addEventListener("change", (e) => {
  chrome.storage.local.set({ reminders: e.target.checked });
});

$("logout").addEventListener("click", async () => {
  await logout();
  say("");
  render();
});

render();
