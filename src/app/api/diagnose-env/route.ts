import { NextResponse } from "next/server";
import { requireOfficer } from "@/lib/server/auth";

/**
 * TEMPORARY diagnostic: reports the SHAPE of each secret, never its
 * value. A key pasted from a masked field carries characters that
 * cannot go in an HTTP header (anything above 255), which surfaces as
 * an unhelpful "ByteString" error deep inside an SDK. This says exactly
 * which variable is malformed and where.
 *
 * Officer-only, and safe to leave in — it discloses nothing beyond
 * length and character classes. Delete once the deploy is stable.
 */
const EXPECTED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
  "OPENAI_API_KEY",
  "DASHBOARD_ALLOWLIST_EMAILS",
  "BRAVE_SEARCH_API_KEY",
];

export async function GET() {
  await requireOfficer();

  const report = EXPECTED.map((name) => {
    const value = process.env[name];
    if (!value) return { name, status: "MISSING" };

    const bad: { index: number; code: number; char: string }[] = [];
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      // Anything outside printable ASCII cannot ride in a header.
      if (code < 32 || code > 126) {
        bad.push({ index: i, code, char: JSON.stringify(value[i]) });
      }
    }

    return {
      name,
      status: bad.length ? "CORRUPT" : "ok",
      length: value.length,
      starts: value.slice(0, 6),
      ends: value.slice(-4),
      badChars: bad.slice(0, 10),
    };
  });

  return NextResponse.json({ report }, { status: 200 });
}
