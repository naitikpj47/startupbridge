import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { allowRequest, PUBLIC_INTAKE_LIMIT } from "@/lib/server/rateLimit";
import { normalizeDomain } from "@/lib/domain";

/**
 * Public submission endpoint. Honeypot first (bots get a convincing
 * success and nothing is written), then the shared rate limit, then the
 * ONE validated RPC does everything atomically.
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  // Honeypot: a visually-hidden "company_fax" field humans never see.
  if (typeof body.company_fax === "string" && body.company_fax.trim() !== "") {
    return NextResponse.json({ status: "submitted" });
  }

  if (!(await allowRequest(request, PUBLIC_INTAKE_LIMIT))) {
    return NextResponse.json(
      { error: "Too many requests — try again in an hour." },
      { status: 429 }
    );
  }

  const domain = normalizeDomain(String(body.website ?? ""));
  if (!domain) {
    return NextResponse.json(
      { error: "Website must be a valid http(s) URL." },
      { status: 400 }
    );
  }

  const sb = createSupabaseAdminClient();
  const { data, error } = await sb.rpc("submit_startup", {
    p: { ...body, domain, company_fax: undefined },
  });
  if (error) {
    console.error(`submit_startup RPC error: ${error.message}`);
    return NextResponse.json({ error: "Submission failed." }, { status: 500 });
  }

  const result = data as { status: string; message?: string; startup_id?: string };
  if (result.status === "invalid") {
    return NextResponse.json({ error: result.message ?? "Invalid submission." }, { status: 400 });
  }
  // claimable / duplicate / submitted all return 200 with a status the
  // UI branches on. startup_id is never exposed to the public client.
  return NextResponse.json({ status: result.status });
}
