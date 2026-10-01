import { test } from "node:test";
import assert from "node:assert/strict";
import { buildExport, csvCell, fetchAllRows, tasksToCsv, toCsv } from "../src/lib/export.ts";

// A fake table with N rows that serves pages the way the database does.
const table = (n: number) => {
  const all = Array.from({ length: n }, (_, i) => ({ id: i }));
  const calls: [number, number][] = [];
  return {
    calls,
    page: async (from: number, to: number) => {
      calls.push([from, to]);
      return { data: all.slice(from, to + 1), error: null };
    },
  };
};

// ---------------- paging: the "silently lose data past 1,000 rows" bug ----------------

test("reads every row across several pages", async () => {
  const t = table(2500);
  const rows = await fetchAllRows(t.page);
  assert.equal(rows.length, 2500);
  assert.deepEqual(rows.map((r) => r.id).slice(998, 1002), [998, 999, 1000, 1001]);
  assert.deepEqual(t.calls, [[0, 999], [1000, 1999], [2000, 2999]]);
});

test("an exact multiple of the page size still stops (needs one extra empty page)", async () => {
  const t = table(2000);
  assert.equal((await fetchAllRows(t.page)).length, 2000);
  assert.equal(t.calls.length, 3);
});

test("empty and tiny tables work", async () => {
  assert.deepEqual(await fetchAllRows(table(0).page), []);
  assert.equal((await fetchAllRows(table(1).page)).length, 1);
  assert.deepEqual(await fetchAllRows(async () => ({ data: null, error: null })), []);
});

test("a database error is thrown, never turned into a partial export", async () => {
  let n = 0;
  const flaky = async () => (n++ === 0 ? { data: Array.from({ length: 1000 }, (_, i) => ({ id: i })), error: null } : { data: null, error: { message: "connection lost" } });
  await assert.rejects(fetchAllRows(flaky), /connection lost/);
});

test("an endless table cannot loop forever", async () => {
  const endless = async () => ({ data: Array.from({ length: 1000 }, () => ({})), error: null });
  await assert.rejects(fetchAllRows(endless, 1000, 3), /more data than one export/);
});

// ---------------- CSV ----------------

test("plain values stay plain; null and undefined become empty", () => {
  assert.equal(csvCell("hello"), "hello");
  assert.equal(csvCell(42), "42");
  assert.equal(csvCell(false), "false");
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(undefined), "");
});

test("commas, quotes and line breaks are quoted correctly", () => {
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("line1\nline2"), '"line1\nline2"');
  assert.equal(csvCell("line1\r\nline2"), '"line1\r\nline2"');
});

test("formula injection: cells that would run as formulas are neutralised", () => {
  for (const evil of ['=HYPERLINK("http://evil.example","click")', "+1+1", "-2+3", "@SUM(A1)", "\t=cmd", "\r=cmd"]) {
    assert.ok(csvCell(evil).replace(/^"/, "").startsWith("'"), `${JSON.stringify(evil)} must start with an apostrophe`);
  }
  assert.equal(csvCell("normal = fine"), "normal = fine"); // only a LEADING symbol is dangerous
  assert.equal(csvCell("-"), "'-");
});

test("a whole table round trips with a header row and CRLF line endings", () => {
  const csv = tasksToCsv([
    { title: "Send RCA, urgent", description: null, status: "todo", priority: "high", due_date: "2026-10-02T03:30:00Z", related_person: "Rajesh", source_type: "email", source_text: 'He said "by Friday"', ai_generated: true, confidence: 0.9, created_at: "2026-10-01T00:00:00Z", completed_at: null },
  ]);
  const [header, row, tail] = csv.split("\r\n");
  assert.equal(header, "title,description,status,priority,due_date,related_person,source_type,source_text,ai_generated,confidence,created_at,completed_at");
  assert.equal(row, '"Send RCA, urgent",,todo,high,2026-10-02T03:30:00Z,Rajesh,email,"He said ""by Friday""",true,0.9,2026-10-01T00:00:00Z,');
  assert.equal(tail, "");
});

test("unicode survives", () => {
  assert.equal(toCsv(["a"], [{ a: "नमस्ते café ✅" }]), "a\r\nनमस्ते café ✅\r\n");
});

// ---------------- the export file ----------------

test("export has the expected shape, counts, and exactly the tables it was given", () => {
  const out = buildExport({
    email: "me@x.com",
    name: "Afrose",
    aiProvider: "anthropic",
    tables: { tasks: [{ id: 1 }, { id: 2 }], commitments: [], inbox_items: [{ id: 3 }], meetings: [] },
    now: new Date("2026-10-05T10:00:00Z"),
  });
  assert.equal(out.app, "ActionBrain");
  assert.equal(out.exported_at, "2026-10-05T10:00:00.000Z");
  assert.deepEqual(out.counts, { tasks: 2, commitments: 0, inbox_items: 1, meetings: 0 });
  assert.deepEqual(out.account, { email: "me@x.com", name: "Afrose", ai_provider: "anthropic" });
  assert.equal(out.tasks.length, 2);
});

test("export is valid JSON and contains no secret-looking fields", () => {
  const text = JSON.stringify(buildExport({ email: "a@b.c", name: null, aiProvider: null, tables: { tasks: [] } }));
  assert.doesNotThrow(() => JSON.parse(text));
  assert.ok(!/encrypted|refresh_token|api_key|secret|password/i.test(text));
});
