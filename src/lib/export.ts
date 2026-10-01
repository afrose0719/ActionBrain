export const EXPORT_VERSION = 1;

type Page<T> = { data: T[] | null; error: { message: string } | null };

/**
 * Reads EVERY row of a table. The database returns at most 1,000 rows per request, so a single query would
 * silently cut off a bigger export. This keeps asking for the next page until a page comes back short.
 */
export async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<Page<T>>,
  pageSize = 1000,
  maxPages = 200
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < maxPages; page++) {
    const { data, error } = await fetchPage(page * pageSize, page * pageSize + pageSize - 1);
    if (error) throw new Error(error.message);
    const got = data ?? [];
    rows.push(...got);
    if (got.length < pageSize) return rows;
  }
  throw new Error("There is more data than one export can hold. Please contact support.");
}

type Cell = string | number | boolean | null | undefined;

/**
 * One CSV cell. Quotes anything containing a comma, quote or line break.
 * Cells that start with = + - @ are prefixed with ' so Excel and Sheets treat them as text, never as a formula
 * ("CSV injection": a task titled =HYPERLINK(...) must not run when the file is opened).
 */
export function csvCell(value: Cell): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<K extends string>(columns: readonly K[], rows: Record<K, Cell>[]): string {
  const lines = [columns.map(csvCell).join(",")];
  for (const row of rows) lines.push(columns.map((c) => csvCell(row[c])).join(","));
  return lines.join("\r\n") + "\r\n";
}

export const TASK_COLUMNS = [
  "title",
  "description",
  "status",
  "priority",
  "due_date",
  "related_person",
  "source_type",
  "source_text",
  "ai_generated",
  "confidence",
  "created_at",
  "completed_at",
] as const;

export function tasksToCsv(tasks: Record<(typeof TASK_COLUMNS)[number], Cell>[]): string {
  return toCsv(TASK_COLUMNS, tasks);
}

/** The full export. It only ever contains what the caller passes in, and the caller never passes secrets. */
export function buildExport<T extends Record<string, unknown[]>>(input: {
  email: string | null;
  name: string | null;
  aiProvider: string | null;
  tables: T;
  now?: Date;
}) {
  return {
    app: "ActionBrain",
    version: EXPORT_VERSION,
    exported_at: (input.now ?? new Date()).toISOString(),
    account: { email: input.email, name: input.name, ai_provider: input.aiProvider },
    counts: Object.fromEntries(Object.entries(input.tables).map(([k, v]) => [k, v.length])),
    ...input.tables,
  };
}
