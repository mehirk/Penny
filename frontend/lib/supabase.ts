import { Capacitor } from "@capacitor/core";
import { createBrowserClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { setAppSignedIn } from "./face-id";

let browserClient: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}

export function createSupabaseBrowserClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase environment variables are not configured");
  // The iOS app's web view doesn't keep cookies on its capacitor:// origin, so the session lives in localStorage there.
  browserClient ??= Capacitor.isNativePlatform()
    ? createClient(url, key, { auth: { detectSessionInUrl: false } })
    : createBrowserClient(url, key);
  return browserClient;
}

/** The signed-in user's Supabase access token, or null when there is no session. */
export async function getSupabaseAccessToken(): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  const { data } = await createSupabaseBrowserClient().auth.getSession();
  return data.session?.access_token ?? null;
}

/** Email of the signed-in Supabase user, for display only. The API verifies identity itself. */
export async function getSupabaseUserEmail(): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  const { data } = await createSupabaseBrowserClient().auth.getSession();
  return data.session?.user.email ?? null;
}

/** `local` only forgets the session on this device (after the account was deleted, the server
 * no longer knows it). */
export async function signOutOfSupabase(scope: "global" | "local" = "global"): Promise<void> {
  setAppSignedIn(false);
  if (isSupabaseConfigured()) await createSupabaseBrowserClient().auth.signOut({ scope });
}
