/**
 * Phase 2 backfill (spec patch 11): enqueue recompute + embedding jobs for
 * every startup, and enrichment + embedding jobs for every problem, then
 * drain the queue through the real worker. Idempotent — recompute is
 * deterministic, briefs are skipped if present, embeddings are re-written.
 *
 *   npx tsx scripts/backfill-phase2.ts
 */
import { loadEnvLocal, scriptAdminClient } from "./script-utils";
import { enqueueJob, runWorker } from "../src/lib/jobs";

loadEnvLocal();

async function main() {
  const sb = scriptAdminClient();

  const { data: startups, error: sErr } = await sb
    .from("startups")
    .select("id, name")
    .order("created_at");
  if (sErr || !startups) throw new Error(sErr?.message ?? "no startups");

  const { data: problems, error: pErr } = await sb
    .from("problems")
    .select("id, title")
    .order("created_at");
  if (pErr || !problems) throw new Error(pErr?.message ?? "no problems");

  console.log(`Enqueueing jobs for ${startups.length} startups and ${problems.length} problems...`);

  // FIFO queue: recomputes first so profile_text exists before embedding.
  // enrich_problem chains its own embed, so no separate embed_problem jobs.
  for (const s of startups) await enqueueJob(sb, "recompute_startup", { startup_id: s.id });
  for (const p of problems) await enqueueJob(sb, "enrich_problem", { problem_id: p.id });
  for (const s of startups) await enqueueJob(sb, "embed_startup", { startup_id: s.id });

  console.log("Draining queue through worker...\n");
  const t0 = Date.now();
  const result = await runWorker(sb, {
    drain: true,
    onJob: (job, ok, err) =>
      console.log(
        `${ok ? "ok  " : "FAIL"} ${job.type.padEnd(18)} ${JSON.stringify(job.payload)}${err ? ` — ${err}` : ""}`
      ),
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\nDone in ${secs}s — ${result.succeeded} succeeded, ${result.failed} failed permanently.`);

  // Verification summary straight from the database.
  const { count: scored } = await sb
    .from("startup_profiles")
    .select("*", { count: "exact", head: true })
    .not("base_readiness", "is", null);
  const { count: embedded } = await sb
    .from("startup_profiles")
    .select("*", { count: "exact", head: true })
    .not("embedding", "is", null);
  const { count: withText } = await sb
    .from("startup_profiles")
    .select("*", { count: "exact", head: true })
    .not("profile_text", "is", null);
  const { count: briefs } = await sb
    .from("problems")
    .select("*", { count: "exact", head: true })
    .not("enriched_brief", "is", null);
  const { count: problemVecs } = await sb
    .from("problems")
    .select("*", { count: "exact", head: true })
    .not("embedding", "is", null);

  console.log(
    `DB state: profile_text ${withText}/15 · base_readiness ${scored}/15 (3 NULL by design) · ` +
    `startup embeddings ${embedded}/15 · briefs ${briefs}/3 · problem embeddings ${problemVecs}/3`
  );

  if (result.failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
