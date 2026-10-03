// The parts of the Microsoft Teams connection that run in the BROWSER as well as on the server. No Node-only code in here.

/** A domain such as "contoso.com" (what an admin's tenant is known by). Anything else is refused. */
export const isTenantDomain = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 253 && /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value);

/** What to tell a person when Microsoft sends them back with an error. */
export function friendlyAuthError(error: string | null, description: string | null): { message: string; adminNeeded: boolean } {
  const text = `${error ?? ""} ${description ?? ""}`;
  // AADSTS65001: the user or an admin has not consented. AADSTS90094: admin consent is required. AADSTS90008 / 900941: needs admin approval workflow.
  if (/AADSTS(65001|90094|900941|90095)|consent_required|admin.?approval|need admin approval/i.test(text)) {
    return {
      message: "Your organisation needs an administrator to approve ActionBrain before you can connect. Use \"Ask your admin\" below to create a link to send them.",
      adminNeeded: true,
    };
  }
  if (/AADSTS65004|access_denied/i.test(text)) {
    return { message: "The Microsoft permission screen was cancelled, so nothing was connected.", adminNeeded: false };
  }
  if (/AADSTS50020|AADSTS500200|personal.*account|MSA/i.test(text)) {
    return { message: "That looks like a personal Microsoft account. Teams chats need a work or school account.", adminNeeded: false };
  }
  return { message: "Microsoft returned an error, so nothing was connected. Try again, or ask your administrator.", adminNeeded: false };
}
