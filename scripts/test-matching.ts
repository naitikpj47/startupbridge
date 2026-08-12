/**
 * Deterministic tests for the gate and match-scoring math against
 * hand-computed expectations. Pure library tests — no DB, no AI.
 *
 *   npx tsx scripts/test-matching.ts
 */
import { evaluateGate } from "../src/lib/matching/gate";
import {
  computeContextFit,
  computeStrategicFit,
  computeFinalScore,
} from "../src/lib/matching/scoring";

let pass = 0;
const failures: string[] = [];

function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` — got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`}`);
  if (ok) pass++;
  else failures.push(name);
}

// ── Gate ────────────────────────────────────────────────────────────────
const founder = { poc_status: "founder_provided", infra_intensity: "founder_provided" };
const scraped = { poc_status: "scraped", infra_intensity: "scraped" };

let g = evaluateGate({ poc_status: "none", infra_intensity: "plug_and_play", field_provenance: founder });
check("gate: confirmed no-PoC excluded", g.eligible, false);
check("gate: exclusion carries founder copy", g.founderCopy?.includes("Held until PoC confirmed"), true);

g = evaluateGate({ poc_status: "deployed_in_field", infra_intensity: "heavy", field_provenance: founder });
check("gate: confirmed heavy infra excluded", g.eligible, false);
check("gate: heavy-infra exclusion carries same founder copy", g.founderCopy?.includes("Held until PoC confirmed"), true);

g = evaluateGate({ poc_status: null, infra_intensity: null, field_provenance: {} });
check("gate: double NULL passes", g.eligible, true);
check("gate: double NULL carries 2 verify flags", g.verifyFlags.length, 2);

g = evaluateGate({ poc_status: "pilot_completed", infra_intensity: "moderate", field_provenance: scraped });
check("gate: scraped values pass flagged", g.eligible, true);
check("gate: scraped values carry 2 flags", g.verifyFlags.length, 2);

g = evaluateGate({ poc_status: "deployed_in_field", infra_intensity: "plug_and_play", field_provenance: founder });
check("gate: verified clean pass has no flags", g.verifyFlags.length, 0);

g = evaluateGate({ poc_status: "pilot_completed", infra_intensity: null, field_provenance: founder });
check("gate: one NULL field → exactly 1 flag", g.verifyFlags.length, 1);

// ── context_fit (patch 3) ───────────────────────────────────────────────
const W = { geo_country_active: 40, geo_same_region: 25, sector_overlap: 35, sdg_overlap: 25 };
const REGIONS: Record<string, string> = {
  PH: "Southeast Asia", ID: "Southeast Asia", VN: "Southeast Asia",
  BD: "South Asia", JP: "East Asia", KR: "East Asia", AU: "Oceania",
};
const regionOf = (iso: string) => REGIONS[iso];

check(
  "context: full match = 100",
  computeContextFit(
    { country: "PH", sector: "health", sdg_tags: ["SDG3"] },
    { countries_active: ["JP", "PH", "VN"], sectors: ["health"], sdg_tags: ["SDG3"] },
    W, regionOf
  ),
  100
);
check(
  "context: region-only geo + sector, no SDG overlap = 60",
  computeContextFit(
    { country: "PH", sector: "health", sdg_tags: ["SDG3"] },
    { countries_active: ["ID", "VN"], sectors: ["health"], sdg_tags: ["SDG13"] },
    W, regionOf
  ),
  60
);
check(
  "context: everything known, nothing matches = 0",
  computeContextFit(
    { country: "BD", sector: "health", sdg_tags: ["SDG13"] },
    { countries_active: ["JP"], sectors: ["agriculture"], sdg_tags: ["SDG3"] },
    W, regionOf
  ),
  0
);
check(
  "context: unknown sector drops from denominator (patch 3)",
  computeContextFit(
    { country: "PH", sector: "health", sdg_tags: ["SDG3"] },
    { countries_active: ["PH"], sectors: null, sdg_tags: ["SDG3"] },
    W, regionOf
  ),
  100 // (40 + 25) / (40 + 25)
);
check(
  "context: only geography known, region match = 63",
  computeContextFit(
    { country: "PH", sector: "health", sdg_tags: ["SDG3"] },
    { countries_active: ["ID"], sectors: null, sdg_tags: null },
    W, regionOf
  ),
  63 // round(100 * 25/40)
);
check(
  "context: all sub-signals unknown → NULL, never 0",
  computeContextFit(
    { country: "PH", sector: "health", sdg_tags: ["SDG3"] },
    { countries_active: null, sectors: null, sdg_tags: null },
    W, regionOf
  ),
  null
);
check(
  "context: SDG fraction (1 of 2 covered) = 88",
  computeContextFit(
    { country: "BD", sector: "climate", sdg_tags: ["SDG13", "SDG11"] },
    { countries_active: ["BD"], sectors: ["climate"], sdg_tags: ["SDG13"] },
    W, regionOf
  ),
  88 // round(100 * (40 + 35 + 12.5) / 100)
);

// ── strategic_fit ───────────────────────────────────────────────────────
const CW = { JP: 10, KR: 8, CA: 5, AU: 3, default: 0 };
check("strategic: JP = 100", computeStrategicFit("JP", CW), 100);
check("strategic: KR = 80", computeStrategicFit("KR", CW), 80);
check("strategic: AU = 30", computeStrategicFit("AU", CW), 30);
check("strategic: unlisted country = default 0", computeStrategicFit("VN", CW), 0);
check("strategic: unknown hq = default 0 (policy, patch 2)", computeStrategicFit(null, CW), 0);

// ── final_score (patch 2) ───────────────────────────────────────────────
const FW = { similarity: 0.35, readiness: 0.3, context: 0.2, strategic: 0.15 };

check(
  "final: all components known",
  computeFinalScore(0.6, 80, 100, 100, FW),
  80 // .35*60 + .30*80 + .20*100 + .15*100 = 80 / 1.0
);
check(
  "final: NULL readiness renormalizes evidence, strategic stays",
  computeFinalScore(0.6, null, 100, 0, FW),
  59 // (21 + 20 + 0) / (.35 + .20 + .15) = 41/.70 = 58.57
);
check(
  "final: thin profile (readiness+context NULL)",
  computeFinalScore(0.5, null, null, 0, FW),
  35 // (17.5 + 0) / (.35 + .15) = 35
);
check(
  "final: strategic 0 still dilutes (denominator keeps .15)",
  computeFinalScore(0.5, 50, 50, 0, FW),
  43 // (17.5 + 15 + 10 + 0) / 1.0 = 42.5 → 43
);
try {
  computeFinalScore(1.3, 50, 50, 0, FW);
  check("final: distance-like similarity throws (patch 8)", "no throw", "throws");
} catch {
  pass++;
  console.log("PASS  final: distance-like similarity throws (patch 8)");
}

console.log(`\n${pass}/${pass + failures.length} passed`);
if (failures.length) {
  console.error(`FAILURES: ${failures.join("; ")}`);
  process.exit(1);
}
