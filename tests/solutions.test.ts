/* Deterministic tests for the solutions-menu filter engine and the
 * pilot sanitizers. No database, no network, no model calls. */
import {
  parseFilters,
  matchesFilters,
  sortSolutions,
  facetOptions,
  activeFilterCount,
  type SolutionRow,
} from "../src/lib/solutions";
import {
  cleanObjectives,
  cleanMilestones,
  cleanBudget,
  cleanDuration,
  pathwayWithStage,
  seedObjectives,
  PPP_STAGES,
} from "../src/lib/pilots-shared";

let pass = 0;
let fail = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(
    `${ok ? "  ok  " : "  FAIL"}  ${name}` +
      (ok ? "" : `\n         got ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`)
  );
  ok ? pass++ : fail++;
}

/** A fully-known, matchable, deployed startup — the happy row. */
function row(overrides: Partial<SolutionRow> = {}): SolutionRow {
  return {
    id: "s1",
    name: "Frostvane Systems",
    domain: "frostvane.example",
    tagline: "Cold-chain telemetry for rural clinics",
    description: "Vaccine cold-chain monitoring.",
    status: "approved",
    source: "self_serve",
    createdAt: "2026-08-01T00:00:00Z",
    matchable: true,
    sectors: ["health"],
    sdgTags: ["SDG3"],
    techTypes: ["iot"],
    hqCountry: "KR",
    countriesActive: ["PH", "VN"],
    regions: ["East Asia", "Southeast Asia"],
    pocStatus: "deployed_in_field",
    infraIntensity: "plug_and_play",
    readiness: 85,
    confidence: "high",
    govExperience: true,
    backing: true,
    fundingUsd: 2_000_000,
    teamSize: 12,
    hasMetrics: true,
    profileText: "Deployed across island provinces.",
    ...overrides,
  };
}

const f = (params: Record<string, string | string[]>) => parseFilters(params);

console.log("\nsolutions filter engine");

// Defaults: approved pool, readiness sort, nothing else narrowing.
check("default status is the vetted pool", f({}).status, "approved");
check("default is zero narrowing filters", activeFilterCount(f({})), 0);
check("a submitted row is hidden by default", matchesFilters(row({ status: "submitted" }), f({})), false);
check("status=any shows it", matchesFilters(row({ status: "submitted" }), f({ status: "any" })), true);

// The NULL rule in filters: unknown is explicit, never a quiet match.
check(
  "filtering for deployed excludes unknown PoC",
  matchesFilters(row({ pocStatus: null }), f({ poc: "deployed_in_field" })),
  false
);
check(
  "unknown PoC is explicitly selectable",
  matchesFilters(row({ pocStatus: null }), f({ poc: "unknown" })),
  true
);
check(
  "deployed+unknown together match both",
  [
    matchesFilters(row(), f({ poc: ["deployed_in_field", "unknown"] })),
    matchesFilters(row({ pocStatus: null }), f({ poc: ["deployed_in_field", "unknown"] })),
  ],
  [true, true]
);
check(
  "gov=unknown matches only null, not confirmed-no",
  [
    matchesFilters(row({ govExperience: null }), f({ gov: "unknown" })),
    matchesFilters(row({ govExperience: false }), f({ gov: "unknown" })),
  ],
  [true, false]
);

// Bands.
check("readiness 85 is in the 80+ band", matchesFilters(row(), f({ readiness: "80" })), true);
check("readiness 79 is not", matchesFilters(row({ readiness: 79 }), f({ readiness: "80" })), false);
check(
  "unscored readiness only matches the unscored band",
  [
    matchesFilters(row({ readiness: null }), f({ readiness: "0" })),
    matchesFilters(row({ readiness: null }), f({ readiness: "unscored" })),
  ],
  [false, true]
);
check("$2M lands in the 1m–5m band", matchesFilters(row(), f({ funding: "1m" })), true);
check(
  "bootstrapped ($0) is zero, not unknown",
  [
    matchesFilters(row({ fundingUsd: 0 }), f({ funding: "zero" })),
    matchesFilters(row({ fundingUsd: 0 }), f({ funding: "unknown" })),
  ],
  [true, false]
);
check(
  "exactly $5M is the 1m band (over-5m is strict)",
  matchesFilters(row({ fundingUsd: 5_000_000 }), f({ funding: "1m" })),
  true
);
check("team of 12 is the 6–20 band", matchesFilters(row(), f({ team: "6" })), true);

// Geography.
check("active-in matches any overlap", matchesFilters(row(), f({ active: "PH" })), true);
check("region matches resolved regions", matchesFilters(row(), f({ region: "Southeast Asia" })), true);
check("hq filter is exact", matchesFilters(row(), f({ hq: "KR" })), true);
check("hq mismatch excludes", matchesFilters(row(), f({ hq: "US" })), false);
check(
  "hq=unknown matches a null HQ",
  matchesFilters(row({ hqCountry: null }), f({ hq: "unknown" })),
  true
);

// The gate filter.
check("fit=held excludes matchable rows", matchesFilters(row(), f({ fit: "held" })), false);
check(
  "fit=held includes gated rows",
  matchesFilters(row({ matchable: false }), f({ fit: "held" })),
  true
);

// Text search: every word, any field, any order.
check(
  "search hits profile text",
  matchesFilters(row(), f({ q: "island provinces" })),
  true
);
check(
  "word order is irrelevant",
  matchesFilters(row(), f({ q: "provinces island" })),
  true
);
check("a missing word excludes", matchesFilters(row(), f({ q: "island desert" })), false);
check("search is case-insensitive", matchesFilters(row(), f({ q: "FROSTVANE" })), true);

// Sector overlap is case-insensitive both ways.
check("sector filter is case-insensitive", matchesFilters(row(), f({ sector: "Health" })), true);

// Sorting.
const a = row({ id: "a", name: "Alpha", readiness: 90 });
const b = row({ id: "b", name: "Beta", readiness: null });
const c = row({ id: "c", name: "Gamma", readiness: 40 });
check(
  "readiness sort puts unscored last, not zeroth",
  sortSolutions([b, c, a], "readiness").map((r) => r.id),
  ["a", "c", "b"]
);
check(
  "name sort is alphabetical",
  sortSolutions([c, a, b], "name").map((r) => r.name),
  ["Alpha", "Beta", "Gamma"]
);

// Facet options derive from data — no dead checkboxes.
const opts = facetOptions([row(), row({ id: "s2", sectors: ["water"], hqCountry: null })]);
check("facet sectors are the distinct set", opts.sectors, ["health", "water"]);
check("a null HQ contributes no option", opts.hqs, ["KR"]);

console.log("\npilot sanitizers");

check(
  "objectives: trims, drops empties, keeps measure",
  cleanObjectives([
    { text: "  Detect cases within 48h ", measure: " confirmed reports " },
    { text: "   ", measure: "x" },
  ]),
  [{ text: "Detect cases within 48h", measure: "confirmed reports" }]
);
check("objectives: junk input is empty, never a throw", cleanObjectives("junk"), []);
check(
  "milestones: out-of-window months are dropped, rest sorted",
  cleanMilestones(
    [
      { month: 13, deliverable: "too late" },
      { month: 6, deliverable: "midline" },
      { month: 3, deliverable: "baseline" },
      { month: 0, deliverable: "too early" },
    ],
    12
  ),
  [
    { month: 3, deliverable: "baseline" },
    { month: 6, deliverable: "midline" },
  ]
);
check("budget: the default is valid", cleanBudget(500000), 500000);
check("budget: zero is rejected", cleanBudget(0), null);
check("budget: negative is rejected", cleanBudget(-5), null);
check("budget: non-numeric is rejected", cleanBudget("lots"), null);
check("duration: 12 months is valid", cleanDuration(12), 12);
check("duration: 61 months is rejected", cleanDuration(61), null);
check("duration: zero is rejected", cleanDuration(0), null);

console.log("\nPPP pathway");

const p1 = pathwayWithStage({}, "counterpart", true, "ministry focal point named");
check("pathway always carries every stage in order", p1.stages.map((s) => s.key), PPP_STAGES.map((s) => s.key));
check(
  "the updated stage is done with its note",
  p1.stages.find((s) => s.key === "counterpart"),
  { key: "counterpart", done: true, note: "ministry focal point named" }
);
check(
  "other stages stay untouched",
  p1.stages.filter((s) => s.done).length,
  1
);
const p2 = pathwayWithStage(p1, "evaluation", true, "results documented");
check("a second update preserves the first", p2.stages.filter((s) => s.done).length, 2);
check(
  "junk keys in stored data are dropped on merge",
  pathwayWithStage({ stages: [{ key: "bogus", done: true, note: "" }] }, "close", false, "")
    .stages.some((s) => s.key === "bogus"),
  false
);

console.log("\nobjective seeding — the officer's words only");

const answers = [
  { key: "problem", value: "undetected cases", unknown: false },
  { key: "success", value: "cases detected within 48 hours", unknown: false },
];
check(
  "seeds verbatim from the confirmed success answer",
  seedObjectives(answers),
  [{ text: "cases detected within 48 hours", measure: "" }]
);
check(
  "an unknown success answer seeds nothing",
  seedObjectives([{ key: "success", value: "whatever", unknown: true }]),
  []
);
check("a pre-intake problem (null answers) seeds nothing", seedObjectives(null), []);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
