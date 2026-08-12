import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { allowRequest, PUBLIC_INTAKE_LIMIT } from "@/lib/server/rateLimit";
import { normalizeDomain } from "@/lib/domain";

/** Verify a claim code: on success the startup becomes claimed and the
 * verified address becomes its contact email. Max 5 attempts per code. */
export async function POST(request: Request) {
  if (!(await allowRequest(request, PUBLIC_INTAKE_LIMIT))) {
    return NextResponse.json(
      { error: "Too many requests — try again in an hour." },
      { status: 429 }
    );
  }

  let website = "";
  let email = "";
  let code = "";
  try {
    const body = await request.json();
    website = String(body.website ?? "");
    email = String(body.email ?? "").trim().toLowerCase();
    code = String(body.code ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const domain = normalizeDomain(website);
  if (!domain || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "Invalid code." }, { status: 400 });
  }

  const sb = createSupabaseAdminClient();
  const { data: startup } = await sb
    .from("startups")
    .select("id, claimed")
    .eq("domain", domain)
    .maybeSingle();
  if (!startup || startup.claimed) {
    return NextResponse.json({ error: "Invalid code." }, { status: 400 });
  }

  const { data: record } = await sb
    .from("claim_codes")
    .select("id, code_hash, expires_at, attempts")
    .eq("startup_id", startup.id)
    .eq("email", email)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (
    !record ||
    record.attempts >= 5 ||
    new Date(record.expires_at).getTime() < Date.now()
  ) {
    return NextResponse.json({ error: "Invalid code." }, { status: 400 });
  }

  await sb
    .from("claim_codes")
    .update({ attempts: record.attempts + 1 })
    .eq("id", record.id);

  const hash = createHash("sha256").update(code).digest("hex");
  if (hash !== record.code_hash) {
    return NextResponse.json({ error: "Invalid code." }, { status: 400 });
  }

  const { error: uErr } = await sb
    .from("startups")
    .update({ claimed: true, contact_email: email })
    .eq("id", startup.id);
  if (uErr) {
    console.error(`claim update failed: ${uErr.message}`);
    return NextResponse.json({ error: "Could not complete the claim." }, { status: 500 });
  }
  await sb.from("claim_codes").delete().eq("startup_id", startup.id);

  return NextResponse.json({ status: "claimed" });
}
