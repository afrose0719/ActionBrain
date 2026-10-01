// Google Calendar (read-only). Server-side only: uses the client secret.
// Scope calendar.events.readonly is classed "non-sensitive" by Google, so no verification review is required.

export const SCOPES = ["https://www.googleapis.com/auth/calendar.events.readonly", "openid", "email"];
export const CALENDAR_SCOPE = SCOPES[0];

export class GoogleError extends Error {
  constructor(message: string, public code: "NOT_CONNECTED" | "TOKEN_REVOKED" | "FAILED") {
    super(message);
  }
}

export function googleConfig() {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  return id && secret ? { id, secret } : null;
}

/** Must match the "Authorized redirect URI" in Google Cloud exactly. */
export function redirectUri(request: Request) {
  return process.env.GOOGLE_REDIRECT_URI || `${new URL(request.url).origin}/google/callback`;
}

export function buildAuthUrl(clientId: string, redirect: string, state: string) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirect,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline", // gives us a refresh token
    prompt: "consent", // makes Google return the refresh token every time
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
};

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const data = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok) {
    if (data.error === "invalid_grant") {
      throw new GoogleError("Google access has expired or was removed. Please reconnect.", "TOKEN_REVOKED");
    }
    throw new GoogleError(data.error_description || data.error || "Google rejected the request.", "FAILED");
  }
  return data;
}

export async function exchangeCode(code: string, redirect: string) {
  const cfg = googleConfig();
  if (!cfg) throw new GoogleError("Google is not configured on this server.", "FAILED");
  const data = await tokenRequest({
    code,
    client_id: cfg.id,
    client_secret: cfg.secret,
    redirect_uri: redirect,
    grant_type: "authorization_code",
  });

  if (!data.refresh_token) {
    throw new GoogleError(
      "Google did not return a refresh token. Remove ActionBrain at myaccount.google.com/permissions and connect again.",
      "FAILED"
    );
  }
  // Google lets people untick permissions on the consent screen, so check what was really granted.
  if (!data.scope?.split(" ").includes(CALENDAR_SCOPE)) {
    throw new GoogleError("Calendar access was not granted. Connect again and keep the calendar box ticked.", "FAILED");
  }
  return { refreshToken: data.refresh_token, email: emailFromIdToken(data.id_token) };
}

export async function accessTokenFrom(refreshToken: string) {
  const cfg = googleConfig();
  if (!cfg) throw new GoogleError("Google is not configured on this server.", "FAILED");
  const data = await tokenRequest({
    refresh_token: refreshToken,
    client_id: cfg.id,
    client_secret: cfg.secret,
    grant_type: "refresh_token",
  });
  if (!data.access_token) throw new GoogleError("Google did not return an access token.", "FAILED");
  return data.access_token;
}

/** Reads the email from the id_token. It came straight from Google over TLS in the code exchange, so we only display it. */
export function emailFromIdToken(idToken?: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(idToken!.split(".")[1], "base64url").toString("utf8"));
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}

export async function revokeToken(token: string) {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" }).catch(() => {});
}

export type CalendarEvent = {
  id: string;
  title: string;
  start: string; // ISO date-time, or YYYY-MM-DD for all-day events
  end: string | null;
  allDay: boolean;
  attendees: string[];
  link: string | null;
};

type RawEvent = {
  id?: string;
  status?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
  attendees?: { displayName?: string; email?: string; self?: boolean; resource?: boolean; responseStatus?: string }[];
};

/** Keeps only what the app needs. Returns null for cancelled events, events without a start, and ones you declined. */
export function normalizeEvent(e: RawEvent): CalendarEvent | null {
  if (!e.id || e.status === "cancelled") return null;
  const start = e.start?.dateTime ?? e.start?.date;
  if (!start) return null;
  if (e.attendees?.some((a) => a.self && a.responseStatus === "declined")) return null;

  return {
    id: e.id,
    title: (e.summary || "(No title)").slice(0, 200),
    start,
    end: e.end?.dateTime ?? e.end?.date ?? null,
    allDay: !e.start?.dateTime,
    attendees: (e.attendees ?? [])
      .filter((a) => !a.self && !a.resource)
      .map((a) => a.displayName || a.email || "")
      .filter(Boolean)
      .slice(0, 15),
    link: e.hangoutLink ?? e.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri ?? null,
  };
}

export async function listEvents(accessToken: string, from: Date, to: Date): Promise<CalendarEvent[]> {
  const params = new URLSearchParams({
    timeMin: from.toISOString(),
    timeMax: to.toISOString(),
    singleEvents: "true", // expand recurring events into individual occurrences
    orderBy: "startTime",
    maxResults: "60",
  });
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const data = (await res.json().catch(() => ({}))) as { items?: RawEvent[]; error?: { message?: string } };
  if (!res.ok) throw new GoogleError(data.error?.message || `Google Calendar error ${res.status}`, "FAILED");
  return (data.items ?? []).map(normalizeEvent).filter((e): e is CalendarEvent => e !== null);
}
