import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateAction,
  validateCommitments,
  validateMeetingExtras,
  validateSuggestions,
} from "../src/lib/ai/actions.ts";

const tasks = [{ id: "a1", title: "Send RCA" }];

// --- validateAction: the safety layer between the AI and the database ---

test("accepts a valid update and normalises the date to UTC", () => {
  const a = validateAction(
    { action: "UPDATE_TASK", task_id: "a1", changes: { due_date: "2026-10-02T09:00:00+05:30", priority: "high" } },
    tasks
  );
  assert.deepEqual(a, { action: "UPDATE_TASK", task_id: "a1", changes: { priority: "high", due_date: "2026-10-02T03:30:00.000Z" } });
});

test("rejects task ids the AI invented", () => {
  for (const action of ["UPDATE_TASK", "COMPLETE_TASK", "DELETE_TASK"]) {
    const a = validateAction({ action, task_id: "zzz", changes: { priority: "low" } }, tasks);
    assert.equal(a.action, "UNKNOWN", action);
  }
});

test("rejects bad priorities and unparseable dates", () => {
  assert.equal(validateAction({ action: "UPDATE_TASK", task_id: "a1", changes: { priority: "urgent" } }, tasks).action, "UNKNOWN");
  assert.equal(validateAction({ action: "CREATE_TASK", task: { title: "x", due_date: "soon" } }, tasks).action, "UNKNOWN");
});

test("ignores fields the AI must never set (user_id, status)", () => {
  const a = validateAction({ action: "UPDATE_TASK", task_id: "a1", changes: { user_id: "hack", status: "done" } }, tasks);
  assert.equal(a.action, "UNKNOWN"); // nothing allowed was left to change
  const c = validateAction({ action: "CREATE_TASK", task: { title: "ok", user_id: "hack", status: "done" } }, tasks);
  assert.deepEqual(c, { action: "CREATE_TASK", task: { title: "ok" } });
});

test("garbage and unknown actions become UNKNOWN", () => {
  for (const raw of ["rm -rf", null, 42, {}, { action: "DROP_TABLE" }]) {
    assert.equal(validateAction(raw, tasks).action, "UNKNOWN");
  }
});

// --- validateSuggestions (Inbox / Meetings) ---

test("suggestions: keeps good entries, drops bad ones, clamps confidence", () => {
  const out = validateSuggestions({
    suggestions: [
      { title: "Send the RCA document", priority: "high", due_date: "2026-10-02T09:00:00+05:30", confidence: 0.95, quote: "by Friday" },
      { title: "" },
      { priority: "high" },
      "x",
      null,
      { title: "Bad priority", priority: "urgent" },
      { title: "Keep", confidence: 7 },
    ],
  });
  assert.deepEqual(out.map((s) => s.title), ["Send the RCA document", "Keep"]);
  assert.equal(out[1].confidence, 1);
  assert.equal(out[1].priority, "medium");
});

test("suggestions: ignores injected fields and caps the list at 10", () => {
  const out = validateSuggestions({ suggestions: Array.from({ length: 11 }, (_, i) => ({ title: "t" + i, user_id: "hack", state: "created" })) });
  assert.equal(out.length, 10);
  assert.deepEqual(Object.keys(out[0]).sort(), ["confidence", "description", "due_date", "priority", "quote", "related_person", "title"]);
});

test("suggestions: non-object input gives an empty list", () => {
  assert.deepEqual(validateSuggestions("hello"), []);
  assert.deepEqual(validateSuggestions({ suggestions: "nope" }), []);
});

// --- validateCommitments ---

test("commitments: both directions are accepted", () => {
  const out = validateCommitments({
    commitments: [
      { direction: "mine", owner: "Afrose", counterparty: "Client", description: "Send the RCA document", confidence: 0.9, quote: "q" },
      { direction: "theirs", owner: "Anish", description: "Share QA result", confidence: 0.7 },
    ],
  });
  assert.deepEqual(out.map((c) => [c.direction, c.owner_name]), [["mine", "Afrose"], ["theirs", "Anish"]]);
});

test("commitments: bad direction or missing description is dropped; bad date becomes null", () => {
  const out = validateCommitments({
    commitments: [{ direction: "ours", description: "x" }, { direction: "mine" }, { direction: "mine", description: "ok", due_date: "someday" }],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].due_date, null);
});

test("commitments: does not pass through extra fields", () => {
  const [c] = validateCommitments({ commitments: [{ direction: "mine", description: "ok", user_id: "hack", status: "done" }] });
  assert.equal("user_id" in c, false);
  assert.equal("status" in c, false);
});

// --- validateMeetingExtras ---

test("meeting extras: trims, accepts strings or {text}, caps decisions at 15", () => {
  const out = validateMeetingExtras({ summary: " We synced. ", decisions: ["Deploy Friday", { text: "Use new API" }, { x: 1 }, "", 42] });
  assert.deepEqual(out, { summary: "We synced.", decisions: ["Deploy Friday", "Use new API"] });
  assert.equal(validateMeetingExtras({ decisions: Array.from({ length: 30 }, (_, i) => "d" + i) }).decisions.length, 15);
  assert.deepEqual(validateMeetingExtras("nope"), { summary: "", decisions: [] });
});
