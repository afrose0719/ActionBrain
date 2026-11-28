// Where the customer's own keys (Sarvam, OpenAI, Vexa) are kept in the browser (round 9 review).
// By default only until the browser is closed (sessionStorage), so a key is not lying around on the device for weeks.
// "Remember on this device" keeps it in localStorage. Either way it never goes to ActionBrain's database.

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const PREFIX = "actionbrain.secret.";

function stores(): { session: Store | null; local: Store | null } {
  try {
    return { session: window.sessionStorage, local: window.localStorage };
  } catch {
    return { session: null, local: null };
  }
}

export function getSecret(name: string): { value: string; remembered: boolean } {
  const { session, local } = stores();
  const remembered = local?.getItem(PREFIX + name) ?? null;
  if (remembered) return { value: remembered, remembered: true };
  return { value: session?.getItem(PREFIX + name) ?? "", remembered: false };
}

export function setSecret(name: string, value: string, remember: boolean) {
  const { session, local } = stores();
  try {
    session?.removeItem(PREFIX + name);
    local?.removeItem(PREFIX + name);
    if (!value) return;
    (remember ? local : session)?.setItem(PREFIX + name, value);
  } catch {
    /* storage blocked: the key lasts for this page only */
  }
}

/** Moves a key saved by an older version (inside the settings object) into this store, once. */
export function migrateSecret(name: string, oldValue: unknown) {
  if (typeof oldValue === "string" && oldValue && !getSecret(name).value) setSecret(name, oldValue, true);
}
