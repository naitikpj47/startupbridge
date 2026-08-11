import "server-only";
import { createClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/env";

/**
 * Service-role client. Bypasses RLS — server-side only, enforced by the
 * "server-only" import which makes any client-bundle inclusion a build
 * error. Never pass this client's output to the browser unfiltered.
 */
export function createSupabaseAdminClient() {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: { persistSession: false, autoRefreshToken: false },
    }
  );
}
