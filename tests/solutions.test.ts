/* Deterministic tests for the solutions-menu filter engine and the
 * pilot sanitizers. No database, no network, no model calls. */
import {
  parseFilters,
  matchesFilters,
  sortSolutions,
  facetOptions,
  activeFilterCount,
  buildMatrix,
  matrixDimension,
  cellHref,
  cellKey,
  UNKNOWN,
  type SolutionRow,
} from "../src/lib/solutions";
import {
  computePppReadiness,
  pppWeightsFrom,
  bandOf,
  DEFAULT_PPP_WEIGHTS,
  type PppInput,
} from "../src/lib/scoring/ppp";
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
    pppScore: 72,
    pppBand: "ready",
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

console.log("\nthe matrix");

const grid = [
  row({ id: "m1", sectors: ["health"], regions: ["East Asia"] }),
  row({ id: "m2", sectors: ["health", "logistics"], regions: ["East Asia"] }),
  row({ id: "m3", sectors: [], regions: [] }),
];
const m = buildMatrix(grid, matrixDimension("sector"), matrixDimension("region"));
check("cells count memberships", m.cells[cellKey("health", "East Asia")], 2);
check("a second sector lands in its own cell", m.cells[cellKey("logistics", "East Asia")], 1);
check(
  "a row with no sector becomes the unknown bucket",
  m.cells[cellKey(UNKNOWN, UNKNOWN)],
  1
);
check("total counts startups once, not memberships", m.total, 3);
check(
  "a multi-sector startup makes row totals exceed the grand total",
  m.rows.reduce((a, r) => a + r.total, 0) > m.total,
  true
);
check("the overlap is flagged so the UI can explain it", m.multiCounted, true);
check(
  "unknown is always present as an axis value",
  m.rows.some((r) => r.value === UNKNOWN) && m.cols.some((c) => c.value === UNKNOWN),
  true
);
check(
  "an empty cell is absent, not zero-filled",
  m.cells[cellKey("logistics", UNKNOWN)],
  undefined
);
check("max is the largest cell, for heat scaling", m.max, 2);

// Unknown must survive axis capping — the gap is the most informative
// bucket and must never be the one that falls off the end.
const wide = [
  ...Array.from({ length: 40 }, (_, i) =>
    row({ id: `w${i}`, sectors: [`sector${i}`], regions: ["Africa"] })
  ),
  row({ id: "wu", sectors: [], regions: ["Africa"] }),
];
const capped = buildMatrix(wide, matrixDimension("sector"), matrixDimension("region"));
check("wide axes are capped", capped.rowsTruncated, true);
check(
  "...but unknown is kept regardless of rank",
  capped.rows.some((r) => r.value === UNKNOWN),
  true
);

// Cell links must reproduce exactly the number that was clicked.
const href = cellHref(f({}), matrixDimension("sector"), "health", matrixDimension("region"), "East Asia");
check("a cell link sets both dimensions", [
  href.includes("sector=health"),
  href.includes("region=East+Asia") || href.includes("region=East%20Asia"),
], [true, true]);
check("a cell link carries the pivot", href.includes("row=sector") && href.includes("col=region"), true);

const narrowed = parseFilters(Object.fromEntries(new URLSearchParams(href.slice(1))));
check(
  "following a cell link yields exactly that cell's rows",
  grid.filter((r) => matchesFilters(r, narrowed)).length,
  m.cells[cellKey("health", "East Asia")]
);
const unknownHref = cellHref(f({}), matrixDimension("sector"), UNKNOWN, matrixDimension("region"), UNKNOWN);
const unknownFilters = parseFilters(Object.fromEntries(new URLSearchParams(unknownHref.slice(1))));
check(
  "the unknown cell is clickable and selects the unrecorded rows",
  grid.filter((r) => matchesFilters(r, unknownFilters)).map((r) => r.id),
  ["m3"]
);

console.log("\nPPP readiness");

const bare: PppInput = {
  gov_experience: null, poc_status: null, infra_intensity: null,
  funding_raised_usd: null, team_size: null, backing: null,
  countries_active: [], pilot_outcome: null,
};
check("nothing known scores NULL, never 0", computePppReadiness(bare).score, null);
check("...and reads as not assessable", computePppReadiness(bare).band, "unassessed");

const strong = computePppReadiness({
  gov_experience: true,
  poc_status: "deployed_in_field",
  infra_intensity: "heavy",
  funding_raised_usd: 8_000_000,
  team_size: 60,
  backing: true,
  countries_active: ["KH", "BD", "PH"],
  pilot_outcome: "met_objectives",
});
check("everything strong scores 100", strong.score, 100);
check("...on all eight signals", strong.knownCount, 8);
check("...with no thin-evidence flag", strong.thinEvidence, false);
check("...and bands as ready", strong.band, "ready");

const weak = computePppReadiness({
  gov_experience: false,
  poc_status: "none",
  infra_intensity: "plug_and_play",
  funding_raised_usd: 0,
  team_size: 2,
  backing: false,
  countries_active: ["PH"],
  pilot_outcome: "not_met",
});
check("everything weak still scores, and low", weak.score !== null && weak.score < 20, true);
check("...and bands as pilot first", weak.band, "pilot_first");

// The NULL rule: an unknown must not drag a company down.
const govOnly = computePppReadiness({ ...bare, gov_experience: true });
check("one strong known signal scores 100 of what is known", govOnly.score, 100);
check("...on a single known signal", govOnly.knownCount, 1);
check("...but a lone signal cannot earn the top band", govOnly.band, "approaching");
check("...and is flagged as thin evidence", govOnly.thinEvidence, true);
check(
  "three known signals unlock it",
  computePppReadiness({
    ...bare, gov_experience: true, poc_status: "deployed_in_field", team_size: 60,
  }).band,
  "ready"
);
check(
  "the breadth floor is configurable",
  bandOf(100, 1, { ...DEFAULT_PPP_WEIGHTS, min_signals_for_ready: 1 }),
  "ready"
);
const govPlusUnknowns = computePppReadiness({
  ...bare, gov_experience: true, countries_active: [],
});
check(
  "adding unknowns does not lower the score",
  govPlusUnknowns.score,
  govOnly.score
);
const govNo = computePppReadiness({ ...bare, gov_experience: false });
check("a confirmed NO does score zero, inside the denominator", govNo.score, 0);
check("...which is different from unknown", govNo.band !== "unassessed", true);

// The inversion that makes this score different from base readiness.
const heavy = computePppReadiness({ ...bare, infra_intensity: "heavy" });
const light = computePppReadiness({ ...bare, infra_intensity: "plug_and_play" });
check(
  "heavy infrastructure scores HIGHER for PPP than plug-and-play",
  heavy.score! > light.score!,
  true
);

// Never having piloted with us is not evidence against a company.
const noPilot = computePppReadiness({ ...bare, gov_experience: true, pilot_outcome: null });
const badPilot = computePppReadiness({ ...bare, gov_experience: true, pilot_outcome: "not_met" });
check(
  "no pilot with us is unknown, not a zero",
  noPilot.score! > badPilot.score!,
  true
);

// Zero recorded countries is unknown too — nobody states 'operates nowhere'.
const noCountries = computePppReadiness({ ...bare, gov_experience: true, countries_active: [] });
check(
  "no recorded countries leaves the denominator",
  noCountries.signals.find((s) => s.key === "jurisdictions")!.known,
  false
);

check("every signal carries a readable note", computePppReadiness(bare).signals.every((s) => s.note.length > 0), true);
check("there are eight signals", computePppReadiness(bare).signals.length, 8);

// Weights are config, and a broken config degrades rather than throws.
check("junk weights fall back to defaults", pppWeightsFrom("nonsense").gov_experience, 30);
check("a partial override merges", pppWeightsFrom({ gov_experience: 50 }).gov_experience, 50);
check("...leaving the rest intact", pppWeightsFrom({ gov_experience: 50 }).pilot_evidence, 25);
check("negative weights are ignored", pppWeightsFrom({ gov_experience: -5 }).gov_experience, 30);

// Filtering and sorting on the band.
check(
  "the ppp facet filters by band",
  [
    matchesFilters(row({ pppBand: "ready" }), f({ ppp: "ready" })),
    matchesFilters(row({ pppBand: "pilot_first" }), f({ ppp: "ready" })),
  ],
  [true, false]
);
check(
  "sorting by ppp puts unassessable last",
  sortSolutions(
    [
      row({ id: "u", name: "U", pppScore: null, pppBand: "unassessed" }),
      row({ id: "h", name: "H", pppScore: 90, pppBand: "ready" }),
      row({ id: "l", name: "L", pppScore: 30, pppBand: "pilot_first" }),
    ],
    "ppp"
  ).map((r) => r.id),
  ["h", "l", "u"]
);

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
