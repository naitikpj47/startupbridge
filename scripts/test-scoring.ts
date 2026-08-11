/**
 * Deterministic check of the scoring library against hand-computed
 * expectations for every seed startup. No AI calls — safe to run anytime.
 *
 *   npx tsx scripts/test-scoring.ts
 */
import { loadEnvLocal, scriptAdminClient } from "./script-utils";
import {
  computeBaseReadiness,
  deriveDataConfidence,
} from "../src/lib/scoring/readiness";
import { loadScoringConfig } from "../src/lib/pipeline";

loadEnvLocal();

// Hand-derived from the seed data + SPEC scoring rules (patch 1).
const EXPECTED: Record<
  string,
  { score: number | null; confidence: "high" | "medium" | "low"; verified: number }
> = {
  "Sentira Health":     { score: 80,   confidence: "high",   verified: 6 },
  "Mulgil Dynamics":    { score: 95,   confidence: "high",   verified: 6 },
  "Frostvane Systems":  { score: 88,   confidence: "high",   verified: 5 },
  "Veridian Crop":      { score: 60,   confidence: "high",   verified: 5 },
  "Gridmere Analytics": { score: 75,   confidence: "high",   verified: 5 },
  "AquaSentry":         { score: 44,   confidence: "high",   verified: 5 },
  "Paddyworks":         { score: 28,   confidence: "high",   verified: 6 },
  "HelioGrid Energy":   { score: 87,   confidence: "high",   verified: 5 },
  "Larkbriar Health":   { score: 27,   confidence: "high",   verified: 6 },
  "TidalGuard":         { score: 60,   confidence: "low",    verified: 0 },
  "Cassava Labs":       { score: 62,   confidence: "medium", verified: 4 },
  "BreezeAI":           { score: null, confidence: "low",    verified: 0 },
  "Kilat Systems":      { score: null, confidence: "low",    verified: 0 },
  "Farmlink Bay":       { score: null, confidence: "low",    verified: 0 },
  "Onsae Health":       { score: 33,   confidence: "high",   verified: 6 },
};

async function main() {
  const sb = scriptAdminClient();
  const weights = await loadScoringConfig(sb);

  const { data: startups, error } = await sb
    .from("startups")
    .select("id, name, startup_profiles(*), affiliations(verified)");
  if (error || !startups) throw new Error(error?.message ?? "no startups");

  let pass = 0;
  let failNames: string[] = [];

  console.log(
    "startup".padEnd(20) + "score".padStart(6) + "  exp".padStart(6) +
    "  conf".padStart(9) + "  verified".padStart(10) + "  result"
  );

  for (const s of startups) {
    const profile = Array.isArray(s.startup_profiles)
      ? s.startup_profiles[0]
      : s.startup_profiles;
    const verifiedCount = (s.affiliations ?? []).filter(
      (a: { verified: boolean }) => a.verified
    ).length;

    const readiness = computeBaseReadiness(profile, verifiedCount, weights);
    const confidence = deriveDataConfidence(readiness.signals);
    const expected = EXPECTED[s.name];

    if (!expected) {
      failNames.push(`${s.name} (no expectation defined)`);
      continue;
    }

    const ok =
      readiness.score === expected.score &&
      confidence.level === expected.confidence &&
      confidence.verifiedCount === expected.verified;

    console.log(
      s.name.padEnd(20) +
      String(readiness.score ?? "null").padStart(6) +
      String(expected.score ?? "null").padStart(6) +
      confidence.level.padStart(9) +
      `${confidence.verifiedCount} of ${confidence.totalSignals}`.padStart(10) +
      (ok ? "  PASS" : "  FAIL")
    );
    if (ok) pass++;
    else failNames.push(s.name);
  }

  console.log(`\n${pass}/${startups.length} passed`);
  if (failNames.length) {
    console.error(`FAILURES: ${failNames.join(", ")}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
