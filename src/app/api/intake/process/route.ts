import { Pool } from "pg";
import { tokenFromHeaders } from "@/lib/intake";
import { readTextBody } from "@/lib/body";
import { decrypt } from "@/lib/crypto";
import { askModel, isProvider } from "@/lib/ai/provider";
import { validateCommitments, validateSuggestions } from "@/lib/ai/actions";
import { INBOX_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import { buildUserPrompt, cleanConnectionString, toSavePayload, workerSsl, type Claim } from "@/lib/zero-touch";

// POST /api/intake/process   (called by the ActionBrain Android app in the background; Milestone 29, zero-touch)
//   Header: Authorization: Bearer abi_...   (the same write-only phone token)
// Analyses this user's phone conversations that have been quiet for 10+ minutes, only if the user switched "Analyse automatically" on.
// Answers counts only, never message text: {"status": "ok" | "off" | "nothing" | "quota" | ..., "processed", "added_tasks", ...}.
//
// Security: the token alone cannot read anything. Reading and saving happen inside the private "worker" schema, which only the
// actionbrain_worker database login can execute; its password (WORKER_DATABASE_URL) exists only on this server.

export const runtime = "nodejs";
export const maxDuration = 60;

const PER_CALL = 3; // conversations per request, so one request stays well inside the time limit

let pool: Pool | null = null;
function workerPool(): Pool | null {
  const url = process.env.WORKER_DATABASE_URL;
  if (!url) return null;
  pool ??= new Pool({ connectionString: cleanConnectionString(url), ssl: workerSsl(process.env.WORKER_DATABASE_CA), max: 1, idleTimeoutMillis: 10_000 });
  return pool;
}

export async function POST(request: Request) {
  const token = tokenFromHeaders(request.headers);
  if (!token) return Response.json({ error: "Missing or malformed token." }, { status: 401 });
  const read = await readTextBody(request, 1024); // no body is needed; anything large is refused
  if (!read.ok) return read.response;

  const db = workerPool();
  if (!db) return Response.json({ status: "not_configured" }, { status: 503 });

  let claim: Claim;
  try {
    claim = (await db.query("select worker.claim_auto_work($1, $2) as r", [token, PER_CALL])).rows[0].r;
  } catch {
    return Response.json({ error: "Could not reach the database." }, { status: 502 });
  }
  if (claim.status === "invalid") return Response.json({ error: "That token is not valid." }, { status: 401 });
  if (claim.status !== "ok") return Response.json({ status: claim.status, waiting: claim.waiting ?? 0 }, { headers: { "Cache-Control": "no-store" } });

  const release = (itemId: string) => db.query("select worker.fail_auto_work($1, $2, $3)", [token, claim.claim, itemId]).catch(() => {});

  let apiKey: string;
  try {
    if (!isProvider(claim.provider)) throw new Error("unknown provider");
    apiKey = decrypt(claim.encrypted_key);
  } catch {
    await Promise.all(claim.items.map((i) => release(i.id)));
    return Response.json({ status: "no_key" });
  }

  let processed = 0, addedTasks = 0, addedCommitments = 0, failed = 0;
  for (const item of claim.items) {
    try {
      const reply = await askModel(
        { provider: claim.provider, model: claim.model, apiKey },
        INBOX_SYSTEM_PROMPT,
        buildUserPrompt(item, claim.user_name, claim.timezone, new Date())
      );
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(reply.replace(/^```(?:json)?\s*|\s*```$/g, "").trim());
      } catch {
        /* an unreadable reply means nothing was found */
      }
      const payload = toSavePayload(validateSuggestions(parsed), validateCommitments(parsed));
      const saved = (
        await db.query("select worker.save_auto_result($1, $2, $3, $4::jsonb, $5::jsonb) as r", [
          token, claim.claim, item.id, JSON.stringify(payload.suggestions), JSON.stringify(payload.commitments),
        ])
      ).rows[0].r as { status: string; added_tasks?: number; added_commitments?: number };
      if (saved.status === "saved") {
        processed++;
        addedTasks += saved.added_tasks ?? 0;
        addedCommitments += saved.added_commitments ?? 0;
      } else failed++;
    } catch {
      failed++;
      await release(item.id); // retried later (at most 3 attempts per conversation)
    }
  }

  return Response.json(
    { status: "ok", processed, failed, added_tasks: addedTasks, added_commitments: addedCommitments, waiting: claim.waiting },
    { headers: { "Cache-Control": "no-store" } }
  );
}
