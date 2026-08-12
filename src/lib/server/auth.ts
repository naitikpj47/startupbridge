import "server-only";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface OfficerContext {
  /** Session-scoped client — RLS applies as the signed-in officer. */
  sb: SupabaseClient;
  email: string;
}

/**
 * The single gate every dashboard page and action passes through.
 * Signed out → /signin. Signed in but not on the team allowlist → the
 * team_members SELECT (RLS-gated by is_team_member) returns nothing and
 * they are turned away. The database enforces the same rule on every
 * query this context makes, so this check is a courtesy, not the wall.
 */
export async function requireOfficer(): Promise<OfficerContext> {
  const sb = await createSupabaseServerClient();
  const {
    data: { user },
  } = await sb.auth.getUser();

  if (!user?.email) redirect("/signin");

  const { data: member } = await sb
    .from("team_members")
    .select("email")
    .eq("email", user.email.toLowerCase())
    .maybeSingle();

  if (!member) redirect("/signin?denied=1");

  return { sb, email: user.email.toLowerCase() };
}
