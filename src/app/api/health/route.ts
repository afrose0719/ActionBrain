import { healthReport } from "@/lib/health";

// GET /api/health  ->  200 {"status":"ok"} when the server is configured, 503 {"status":"degraded"} when it is not.
// Point an uptime monitor (UptimeRobot, Better Stack...) at it.
export function GET() {
  const report = healthReport(process.env);
  return Response.json(report, {
    status: report.status === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
