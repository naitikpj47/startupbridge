/**
 * Phase 3 end-to-end verification:
 *   1. Matching re-run is idempotent (row count unchanged, no dupes).
 *   2. Shortlisting + briefing generation works (rationale + note stored,
 *      generated_at stamped).
 *   3. A further re-run refreshes scores but leaves status, rationale,
 *      and briefing untouched (spec: UPSERT semantics).
 *
 *   npx tsx scripts/verify-phase3.ts
 */
import { loadEnvLocal, scriptAdminClient } from "./script-utils";
import { runMatching } from "../src/lib/matching/engine";
import { generateMatchBriefing } from "../src/lib/matching/briefing";

loadEnvLocal();

async function main() {
  const sb = scriptAdminClient();

  const count = async () => {
    const { count: c } = await sb
      .from("matches")
      .select("*", { count: "exact", head: true });
    return c ?? -1;
  };

  const before = await count();

  const { data: problems } = await sb.from("problems").select("id, title");
  for (const p of problems ?? []) await runMatching(sb, p.id);
  const after = await count();
  console.log(
    `idempotency: ${before} rows before re-run, ${after} after — ${before === after ? "OK" : "FAIL"}`
  );

  // Shortlist the dengue/Sentira match and generate its briefing.
  const { data: match } = await sb
    .from("matches")
    .select("id, startups!inner(name), problems!inner(title)")
    .eq("startups.name", "Sentira Health")
    .ilike("problems.title", "%Dengue%")
    .single();
  if (!match) throw new Error("Sentira/dengue match not found");

  await sb.from("matches").update({ status: "shortlisted" }).eq("id", match.id);
  console.log("shortlisted Sentira Health → dengue; generating briefing...");
  await generateMatchBriefing(sb, match.id);

  const { data: briefed } = await sb
    .from("matches")
    .select("status, rationale, briefing_note, briefing_generated_at, final_score")
    .eq("id", match.id)
    .single();
  console.log(
    `briefing stored: rationale ${briefed?.rationale ? "yes" : "NO"} · ` +
      `note ${briefed?.briefing_note ? `${briefed.briefing_note.length} chars` : "NO"} · ` +
      `stamped ${briefed?.briefing_generated_at ? "yes" : "NO"}`
  );

  // Re-run matching — status/rationale/briefing must survive.
  for (const p of problems ?? []) await runMatching(sb, p.id);
  const { data: post } = await sb
    .from("matches")
    .select("status, rationale, briefing_note, final_score")
    .eq("id", match.id)
    .single();
  const preserved =
    post?.status === "shortlisted" &&
    post?.rationale === briefed?.rationale &&
    post?.briefing_note === briefed?.briefing_note;
  console.log(
    `after re-run: status=${post?.status}, rationale+briefing preserved: ${preserved ? "OK" : "FAIL"}`
  );
  console.log(`final matches count: ${await count()}`);

  console.log("\n--- rationale ---\n" + briefed?.rationale);
  console.log("\n--- briefing note (first 500 chars) ---\n" + briefed?.briefing_note?.slice(0, 500));

  if (before !== after || !preserved) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
