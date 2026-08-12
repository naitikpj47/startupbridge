import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Poll one job's status. Public-safe: only prefill jobs are visible, the
 * job id itself is the unguessable capability, and only status + result
 * + a sanitized error ever leave the server.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const sb = createSupabaseAdminClient();
  const { data, error } = await sb
    .from("jobs")
    .select("type, status, result, error")
    .eq("id", id)
    .maybeSingle();

  if (error || !data || data.type !== "prefill_url") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    status: data.status,
    result: data.result ?? null,
    error:
      data.status === "failed" || data.status === "queued"
        ? (data.error?.slice(0, 200) ?? null)
        : null,
  });
}
