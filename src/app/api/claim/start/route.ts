import { NextResponse } from "next/server";
import { createHash, randomInt } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { allowRequest, PUBLIC_INTAKE_LIMIT } from "@/lib/server/rateLimit";
import { normalizeDomain } from "@/lib/domain";
import { sendClaimCode } from "@/lib/server/mailer";

/**
 * Start the claim flow: the requester must control an email address ON
 * the company domain. A 6-digit code (stored hashed, 15-minute expiry)
 * goes to that address. Responses never reveal whether a domain exists.
 */
export async function POST(request: Request) {
  if (!(await allowRequest(request, PUBLIC_INTAKE_LIMIT))) {
    return NextResponse.json(
      { error: "Too many requests — try again in an hour." },
      { status: 429 }
    );
  }

  let website = "";
  let email = "";
  try {
    const body = await request.json();
    website = String(body.website ?? "");
    email = String(body.email ?? "").trim().toLowerCase();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const domain = normalizeDomain(website);
  const emailMatch = /^[^@\s]+@([^@\s]+)$/.exec(email);
  if (!domain || !emailMatch) {
    return NextResponse.json({ error: "Invalid domain or email." }, { status: 400 });
  }
  const emailDomain = emailMatch[1].replace(/^www\./, "");
  if (emailDomain !== domain) {
    return NextResponse.json(
      { error: `The email must be on the company domain (@${domain}).` },
      { status: 400 }
    );
  }

  const generic = { status: "sent" }; // same response whether or not claimable

  const sb = createSupabaseAdminClient();
  const { data: startup } = await sb
    .from("startups")
    .select("id, source, claimed")
    .eq("domain", domain)
    .maybeSingle();

  if (!startup || startup.claimed || startup.source !== "scraped") {
    return NextResponse.json(generic);
  }

  const code = String(randomInt(100000, 1000000));
  const codeHash = createHash("sha256").update(code).digest("hex");
  const { error } = await sb.from("claim_codes").insert({
    startup_id: startup.id,
    email,
    code_hash: codeHash,
    expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
  });
  if (error) {
    console.error(`claim_codes insert failed: ${error.message}`);
    return NextResponse.json({ error: "Could not start the claim." }, { status: 500 });
  }

  try {
    await sendClaimCode(email, code);
  } catch (e) {
    console.error(`claim code delivery failed: ${e instanceof Error ? e.message : e}`);
  }
  return NextResponse.json(generic);
}
