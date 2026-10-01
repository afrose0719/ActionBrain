import { createClient } from "@/lib/supabase";

/** fetch() for our own API routes: adds the logged-in user's token so the server knows who is calling. */
export async function authFetch(url: string, init: RequestInit = {}) {
  const { data } = await createClient().auth.getSession();
  return fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${data.session?.access_token}`,
      ...init.headers,
    },
  });
}
