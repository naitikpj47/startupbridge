import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { allowRequest, PUBLIC_INTAKE_LIMIT } from "@/lib/server/rateLimit";
import { assertPublicHttpUrl } from "@/lib/enrichment/startup";

/**
 * Queue a URL pre-fill (patch 10: enrichment never runs inside a web
 * request handler — this returns a job id immediately and the UI polls).
 * Shares the public rate limit and the SSRF guard (patch 9).
 */
export async function POST(request: Request) {
  if (!(await allowRequest(request, PUBLIC_INTAKE_LIMIT))) {
    return NextResponse.json(
      { error: "Too many requests — try again in an hour." },
      { status: 429 }
    );
  }

  let url: string;
  try {
    const body = await request.json();
    url = String(body.url ?? "").trim();
    assertPublicHttpUrl(url);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Invalid URL" },
      { status: 400 }
    );
  }

  const sb = createSupabaseAdminClient();
  const { data, error } = await sb
    .from("jobs")
    .insert({ type: "prefill_url", payload: { url } })
    .select("id")
    .single();
  if (error || !data) {
    return NextResponse.json({ error: "Could not queue the request." }, { status: 500 });
  }

  return NextResponse.json({ jobId: data.id });
}
