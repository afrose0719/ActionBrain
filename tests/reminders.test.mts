import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_OVERDUE_AGE, planReminders } from "../extension/reminders.js";

const NOW = Date.parse("2026-10-05T10:00:00Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

const task = (id: string, due: number | null, status = "todo") => ({ id, title: `Task ${id}`, status, due_date: due === null ? null : at(due) });
const commit = (id: string, due: number | null, direction = "mine", status = "open") => ({
  id,
  description: `Commitment ${id}`,
  direction,
  status,
  owner_name: "Anish",
  due_date: due === null ? null : at(due),
});

test("a task due in 30 minutes triggers one 'due soon' reminder", () => {
  const { notifications } = planReminders({ tasks: [task("a", 30 * MIN)], now: NOW });
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].title, "Task due soon");
  assert.equal(notifications[0].message, "Task a");
  assert.equal(notifications[0].path, "/tasks");
});

test("tasks due later than an hour, with no date, or already done are ignored", () => {
  const { notifications } = planReminders({
    tasks: [task("late", 3 * HOUR), task("nodate", null), task("done", -HOUR, "done"), task("future", 2 * DAY)],
    now: NOW,
  });
  assert.equal(notifications.length, 0);
});

test("'due soon' is shown only once, even across many checks", () => {
  const first = planReminders({ tasks: [task("a", 30 * MIN)], now: NOW });
  const second = planReminders({ tasks: [task("a", 15 * MIN)], now: NOW + 15 * MIN, notified: first.notified });
  assert.equal(first.notifications.length, 1);
  assert.equal(second.notifications.length, 0);
});

test("overdue repeats once per day, not on every check", () => {
  const day1 = planReminders({ tasks: [task("a", -2 * HOUR)], now: NOW });
  assert.equal(day1.notifications[0].title, "Task overdue");
  const later = planReminders({ tasks: [task("a", -3 * HOUR)], now: NOW + HOUR, notified: day1.notified });
  assert.equal(later.notifications.length, 0); // same day
  const nextDay = planReminders({ tasks: [task("a", -26 * HOUR)], now: NOW + DAY, notified: day1.notified });
  assert.equal(nextDay.notifications.length, 1); // new day, remind again
});

test("things overdue for more than a week stop nagging", () => {
  const { notifications } = planReminders({ tasks: [task("old", -(MAX_OVERDUE_AGE + HOUR))], now: NOW });
  assert.equal(notifications.length, 0);
});

test("my commitments remind; open items others owe me only remind when overdue", () => {
  const { notifications } = planReminders({
    commitments: [commit("m1", 20 * MIN), commit("t-soon", 20 * MIN, "theirs"), commit("t-late", -HOUR, "theirs")],
    now: NOW,
  });
  const titles = notifications.map((n) => n.title).sort();
  assert.deepEqual(titles, ["Commitment due soon", "Time to chase Anish"]);
  assert.equal(notifications.find((n) => n.title.startsWith("Time to chase"))!.path, "/waiting");
});

test("suggested, done or dismissed commitments are ignored", () => {
  const { notifications } = planReminders({
    commitments: [commit("a", -HOUR, "mine", "suggested"), commit("b", -HOUR, "mine", "done"), commit("c", -HOUR, "mine", "dismissed")],
    now: NOW,
  });
  assert.equal(notifications.length, 0);
});

test("more than three at once are bundled into a single summary, and all count as shown", () => {
  const tasks = ["1", "2", "3", "4", "5"].map((id) => task(id, -HOUR));
  const first = planReminders({ tasks, now: NOW });
  assert.equal(first.notifications.length, 1);
  assert.equal(first.notifications[0].title, "5 items need attention");
  assert.match(first.notifications[0].message, /and 2 more/);
  assert.equal(first.notifications[0].path, "/dashboard");
  const again = planReminders({ tasks, now: NOW + 15 * MIN, notified: first.notified });
  assert.equal(again.notifications.length, 0); // not re-announced 15 minutes later
});

test("overdue items are listed before due-soon ones", () => {
  const { notifications } = planReminders({ tasks: [task("soon", 10 * MIN), task("late", -HOUR)], now: NOW });
  assert.deepEqual(notifications.map((n) => n.message), ["Task late", "Task soon"]);
});

test("old memory is pruned so storage cannot grow forever", () => {
  const { notified } = planReminders({ now: NOW, notified: { "task:x:soon": NOW - 20 * DAY, "task:y:soon": NOW - DAY } });
  assert.deepEqual(Object.keys(notified), ["task:y:soon"]);
});

test("bad dates do not crash it", () => {
  const bad = { id: "z", title: "Z", status: "todo", due_date: "not a date" };
  assert.doesNotThrow(() => planReminders({ tasks: [bad], now: NOW }));
  assert.equal(planReminders({ tasks: [bad], now: NOW }).notifications.length, 0);
});
