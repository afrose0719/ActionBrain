// Decides which desktop reminders to show. Pure functions, no Chrome APIs, so it is unit-tested (tests/reminders.test.mts).

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const SOON_WINDOW = HOUR; // "due soon" = due within the next hour
export const MAX_OVERDUE_AGE = 7 * DAY; // older than this, we stop nagging
export const MAX_SEPARATE = 3; // more than this at once are bundled into one summary
const KEEP_KEYS = 14 * DAY; // how long we remember what we already showed

const dayStamp = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * @param {object} input
 * @param {{id:string,title:string,status:string,due_date:string|null}[]} [input.tasks]
 * @param {{id:string,description:string,direction:string,status:string,owner_name:string|null,due_date:string|null}[]} [input.commitments]
 * @param {number} input.now  epoch ms
 * @param {Record<string, number>} [input.notified]  key -> time we showed it
 * @returns {{ notifications: {key:string,title:string,message:string,path:string}[], notified: Record<string, number> }}
 */
export function planReminders({ tasks = [], commitments = [], now, notified = {} }) {
  const today = dayStamp(now);
  const candidates = [];

  // forget old entries so the stored list never grows forever
  const memory = {};
  for (const [key, at] of Object.entries(notified)) if (now - at < KEEP_KEYS) memory[key] = at;

  const classify = (due) => {
    const ms = Date.parse(due);
    if (Number.isNaN(ms)) return null;
    if (ms < now) return now - ms <= MAX_OVERDUE_AGE ? "overdue" : null;
    return ms - now <= SOON_WINDOW ? "soon" : null;
  };

  for (const t of tasks) {
    if (t.status !== "todo" || !t.due_date) continue;
    const kind = classify(t.due_date);
    if (!kind) continue;
    // "soon" is shown once. "overdue" is shown once per day until it is done.
    const key = kind === "soon" ? `task:${t.id}:soon` : `task:${t.id}:overdue:${today}`;
    candidates.push({
      key,
      title: kind === "soon" ? "Task due soon" : "Task overdue",
      message: t.title,
      path: "/tasks",
      rank: kind === "overdue" ? 0 : 1,
    });
  }

  for (const c of commitments) {
    if (c.status !== "open" || !c.due_date) continue;
    const kind = classify(c.due_date);
    if (!kind) continue;
    if (c.direction === "mine") {
      candidates.push({
        key: kind === "soon" ? `commit:${c.id}:soon` : `commit:${c.id}:overdue:${today}`,
        title: kind === "soon" ? "Commitment due soon" : "Commitment overdue",
        message: c.description,
        path: "/commitments",
        rank: kind === "overdue" ? 0 : 1,
      });
    } else if (kind === "overdue") {
      // something someone owes you is late: a nudge to chase, once per day
      candidates.push({
        key: `wait:${c.id}:overdue:${today}`,
        title: `Time to chase ${c.owner_name || "them"}`,
        message: c.description,
        path: "/waiting",
        rank: 2,
      });
    }
  }

  const fresh = candidates.filter((c) => !(c.key in memory)).sort((a, b) => a.rank - b.rank);
  for (const c of fresh) memory[c.key] = now; // everything we are about to show counts as shown

  let notifications;
  if (fresh.length > MAX_SEPARATE) {
    const names = fresh.slice(0, 3).map((c) => c.message);
    notifications = [
      {
        key: `summary:${today}:${now}`,
        title: `${fresh.length} items need attention`,
        message: names.join(" · ") + (fresh.length > 3 ? ` · and ${fresh.length - 3} more` : ""),
        path: "/dashboard",
      },
    ];
  } else {
    notifications = fresh.map(({ key, title, message, path }) => ({ key, title, message, path }));
  }
  return { notifications, notified: memory };
}
