import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client for browser (client component) use. Anon key only —
 * under our RLS policy the anon role can read nothing and submit only
 * through the validated intake RPC.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
