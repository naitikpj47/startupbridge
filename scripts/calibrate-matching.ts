/**
 * Threshold calibration (spec patch 7): print the full seed similarity
 * matrix (3 problems x 15 startups) and check that the intended seed
 * matches clear the configured threshold. Read-only.
 *
 *   npx tsx scripts/calibrate-matching.ts
 */
import { loadEnvLocal, scriptAdminClient } from "./script-utils";

loadEnvLocal();

// Design intent from the seed data: these pairs MUST clear the threshold.
const INTENDED: Record<string, string[]> = {
  "Dengue hotspot detection and outbreak early warning": ["Sentira Health"],
  "Vaccine cold-chain integrity across island provinces": ["Frostvane Systems"],
  "Community-level flood early warning for river basins": ["Mulgil Dynamics"],
};

async function main() {
  const sb = scriptAdminClient();

  const { data: config } = await sb
    .from("scoring_config")
    .select("similarity_threshold")
    .single();
  const threshold = Number(config?.similarity_threshold ?? 0.5);

  const { data: problems, error } = await sb
    .from("problems")
    .select("id, title")
    .order("created_at");
  if (error || !problems) throw new Error(error?.message);

  const matrix = new Map<string, Map<string, number>>(); // startup -> problem -> sim
  const problemTitles: string[] = [];

  for (const p of problems) {
    problemTitles.push(p.title);
    const { data: sims, error: sErr } = await sb.rpc("problem_similarities", {
      p_problem_id: p.id,
    });
    if (sErr) throw new Error(`problem_similarities: ${sErr.message}`);
    for (const s of sims as { name: string; similarity: number }[]) {
      if (!matrix.has(s.name)) matrix.set(s.name, new Map());
      matrix.get(s.name)!.set(p.title, s.similarity);
    }
  }

  const short = (t: string) =>
    t.includes("Dengue") ? "dengue-PH" : t.includes("cold-chain") ? "coldchain-ID" : "flood-BD";

  console.log(`similarity threshold in config: ${threshold}\n`);
  console.log(
    "startup".padEnd(20) +
      problemTitles.map((t) => short(t).padStart(14)).join("")
  );
  for (const [name, sims] of [...matrix.entries()].sort()) {
    console.log(
      name.padEnd(20) +
        problemTitles
          .map((t) => {
            const v = sims.get(t);
            const cell = v === undefined ? "—" : v.toFixed(3);
            const mark = v !== undefined && v >= threshold ? "*" : " ";
            return (cell + mark).padStart(14);
          })
          .join("")
    );
  }
  console.log("\n(* = clears threshold)");

  let allClear = true;
  for (const [title, names] of Object.entries(INTENDED)) {
    for (const name of names) {
      const sim = matrix.get(name)?.get(title);
      const ok = sim !== undefined && sim >= threshold;
      if (!ok) allClear = false;
      console.log(
        `${ok ? "OK  " : "MISS"} intended: ${name} → ${short(title)} (sim ${sim?.toFixed(3) ?? "n/a"})`
      );
    }
  }

  // Helpful calibration hints either way.
  const intendedSims: number[] = [];
  for (const [title, names] of Object.entries(INTENDED))
    for (const n of names) {
      const v = matrix.get(n)?.get(title);
      if (v !== undefined) intendedSims.push(v);
    }
  const minIntended = Math.min(...intendedSims);
  const others: number[] = [];
  for (const [name, sims] of matrix.entries())
    for (const [title, v] of sims.entries())
      if (!(INTENDED[title] ?? []).includes(name)) others.push(v);
  others.sort((a, b) => b - a);
  console.log(
    `\nmin intended similarity: ${minIntended.toFixed(3)} · highest non-intended: ${others[0]?.toFixed(3)} · 5th highest non-intended: ${others[4]?.toFixed(3)}`
  );
  if (!allClear) {
    console.log(
      `suggestion: set similarity_threshold to ${(Math.floor((minIntended - 0.02) * 100) / 100).toFixed(2)}`
    );
    process.exit(2);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
