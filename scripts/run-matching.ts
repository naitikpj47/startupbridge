/**
 * Open the seed problems and run the matching engine for each, printing
 * ranked results, gate exclusions, and the threshold split.
 *
 *   npx tsx scripts/run-matching.ts
 */
import { loadEnvLocal, scriptAdminClient } from "./script-utils";
import { runMatching, rankedMatches } from "../src/lib/matching/engine";

loadEnvLocal();

async function main() {
  const sb = scriptAdminClient();

  const { data: problems, error } = await sb
    .from("problems")
    .select("id, title, status")
    .order("created_at");
  if (error || !problems) throw new Error(error?.message);

  for (const p of problems) {
    if (p.status === "draft") {
      const { error: oErr } = await sb
        .from("problems")
        .update({ status: "open" })
        .eq("id", p.id);
      if (oErr) throw new Error(`opening problem: ${oErr.message}`);
    }
  }

  for (const p of problems) {
    console.log(`\n=== ${p.title}`);
    const run = await runMatching(sb, p.id);
    console.log(
      `upserted ${run.upserted} matches · ${run.aboveThreshold} above threshold · ` +
        `gate excluded: ${run.excludedByGate.map((e) => `${e.name} (${e.reasons[0]})`).join("; ") || "none"}`
    );

    const ranked = await rankedMatches(sb, p.id);
    const rows = ranked.matches.length ? ranked.matches : ranked.adjacent;
    const label = ranked.matches.length ? "MATCHES" : "ADJACENT (below threshold)";
    console.log(`${label} — threshold ${ranked.threshold}`);
    for (const m of rows) {
      console.log(
        `  ${String(m.final_score).padStart(3)}  ${m.name.padEnd(20)} sim ${m.similarity.toFixed(3)}  ` +
          `ctx ${String(m.context_fit ?? "—").padStart(3)}  strat ${String(m.strategic_fit).padStart(3)}  ` +
          `read ${String(m.base_readiness ?? "—").padStart(4)}  conf ${m.data_confidence ?? "—"}`
      );
    }
  }

  const { count } = await sb
    .from("matches")
    .select("*", { count: "exact", head: true });
  console.log(`\nmatches table now holds ${count} rows`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
