import { getUserClient } from "@/lib/server-auth";
import { adminRedirectUri, buildAdminConsentUrl, isTenantDomain, microsoftConfig } from "@/lib/microsoft";

// GET ?domain=contoso.com  ->  the link to send your organisation's administrator, who approves ActionBrain once for everyone.
// It contains no secret: it only names the app and the permissions it asks for.
export async function GET(request: Request) {
  const auth = await getUserClient(request);
  if (!auth) return Response.json({ error: "Not logged in." }, { status: 401 });

  const cfg = microsoftConfig();
  if (!cfg) return Response.json({ error: "Microsoft Teams is not set up on this server yet.", code: "NOT_CONFIGURED" }, { status: 503 });

  const domain = (new URL(request.url).searchParams.get("domain") ?? "").trim().toLowerCase();
  if (!isTenantDomain(domain)) return Response.json({ error: "Enter your company's domain, for example contoso.com." }, { status: 400 });

  return Response.json({ url: buildAdminConsentUrl(cfg.id, adminRedirectUri(request), domain) });
}
