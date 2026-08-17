/**
 * The solutions menu's filter engine.
 *
 * Pure functions over plain rows — no Supabase, no React — so the whole
 * thing is deterministically testable and the page stays a thin shell.
 *
 * One doctrine note: the NULL-vs-ZERO rule extends to filtering. Every
 * facet that can be unknown offers "unknown" as an explicit choice, and
 * a filter for a known value never quietly matches an unknown one. An
 * officer filtering for field-deployed startups is asking a question
 * about evidence; rows without evidence are a different answer, not a
 * near-miss.
 */

import type { PppBand } from "@/lib/scoring/ppp";

/** The one token meaning "not recorded", shared by every facet. */
export const UNKNOWN = "unknown";
/** Readiness spells its unknown differently — it is a score, not a value. */
export const UNSCORED = "unscored";

export interface SolutionRow {
  id: string;
  name: string;
  domain: string | null;
  tagline: string | null;
  description: string | null;
  status: string;
  source: string;
  createdAt: string;
  /** Passes THE GATE (poc/infra doctrine) — computed by the caller. */
  matchable: boolean;
  sectors: string[];
  sdgTags: string[];
  techTypes: string[];
  hqCountry: string | null;
  countriesActive: string[];
  /** Regions of hq + active countries — resolved by the caller. */
  regions: string[];
  pocStatus: string | null;
  infraIntensity: string | null;
  readiness: number | null;
  confidence: string | null;
  govExperience: boolean | null;
  /** true = verified affiliation exists; false = confirmed none; null = unknown */
  backing: boolean | null;
  fundingUsd: number | null;
  teamSize: number | null;
  hasMetrics: boolean;
  profileText: string | null;
  /** PPP readiness — a different question from base readiness. See
   * src/lib/scoring/ppp.ts. Null when nothing is known. */
  pppScore: number | null;
  pppBand: PppBand;
}

export interface SolutionFilters {
  q: string;
  /** "approved" (default — the vetted menu) | "any" | a single status. */
  status: string;
  /** "" (any) | "matchable" | "held" */
  fit: string;
  /** "" (any) | "yes" | "no" | "unknown" */
  gov: string;
  /** "" (any) | "verified" | "none" | "unknown" */
  backing: string;
  sector: string[];
  sdg: string[];
  tech: string[];
  hq: string[];
  active: string[];
  region: string[];
  poc: string[]; // deployed_in_field | pilot_completed | none | unknown
  infra: string[]; // plug_and_play | moderate | heavy | unknown
  readiness: string[]; // 80 | 60 | 40 | 0 | unscored
  confidence: string[]; // high | medium | low | unknown
  funding: string[]; // 5m | 1m | lt1m | zero | unknown
  team: string[]; // 20 | 6 | 1 | unknown
  source: string[];
  /** ready | approaching | pilot_first | unassessed */
  ppp: string[];
  sort: string; // readiness | ppp | newest | name
}

type Params = Record<string, string | string[] | undefined>;

const list = (v: string | string[] | undefined): string[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];

const one = (v: string | string[] | undefined): string =>
  (Array.isArray(v) ? v[0] : v) ?? "";

export function parseFilters(params: Params): SolutionFilters {
  return {
    q: one(params.q).trim(),
    status: one(params.status) || "approved",
    fit: one(params.fit),
    gov: one(params.gov),
    backing: one(params.backing),
    sector: list(params.sector),
    sdg: list(params.sdg),
    tech: list(params.tech),
    hq: list(params.hq),
    active: list(params.active),
    region: list(params.region),
    poc: list(params.poc),
    infra: list(params.infra),
    readiness: list(params.readiness),
    confidence: list(params.confidence),
    funding: list(params.funding),
    team: list(params.team),
    source: list(params.source),
    ppp: list(params.ppp),
    sort: one(params.sort) || "readiness",
  };
}

/** How many facets are actively narrowing the menu (for the "clear" UI). */
export function activeFilterCount(f: SolutionFilters): number {
  let n = 0;
  if (f.q) n++;
  if (f.status !== "approved") n++;
  if (f.fit) n++;
  if (f.gov) n++;
  if (f.backing) n++;
  for (const k of [
    "sector", "sdg", "tech", "hq", "active", "region",
    "poc", "infra", "readiness", "confidence", "funding", "team", "source", "ppp",
  ] as const) {
    if (f[k].length) n++;
  }
  return n;
}

/** Band membership, shared by the filter and the UI labels. */
export const READINESS_BANDS = [
  { key: "80", label: "80 and above" },
  { key: "60", label: "60–79" },
  { key: "40", label: "40–59" },
  { key: "0", label: "Below 40" },
  { key: "unscored", label: "Not yet scored" },
] as const;

export const FUNDING_BANDS = [
  { key: "5m", label: "Over $5M raised" },
  { key: "1m", label: "$1M–$5M" },
  { key: "lt1m", label: "Under $1M" },
  { key: "zero", label: "Bootstrapped ($0)" },
  { key: "unknown", label: "Funding unknown" },
] as const;

export const TEAM_BANDS = [
  { key: "20", label: "Over 20 people" },
  { key: "6", label: "6–20 people" },
  { key: "1", label: "1–5 people" },
  { key: "unknown", label: "Team size unknown" },
] as const;

function readinessBand(v: number | null): string {
  if (v === null) return "unscored";
  if (v >= 80) return "80";
  if (v >= 60) return "60";
  if (v >= 40) return "40";
  return "0";
}

function fundingBand(v: number | null): string {
  if (v === null) return "unknown";
  if (v > 5_000_000) return "5m";
  if (v >= 1_000_000) return "1m";
  if (v > 0) return "lt1m";
  return "zero";
}

function teamBand(v: number | null): string {
  if (v === null) return "unknown";
  if (v > 20) return "20";
  if (v >= 6) return "6";
  return "1";
}

/** Case-insensitive membership with "unknown" matching null. */
function facetMatch(selected: string[], value: string | null): boolean {
  if (!selected.length) return true;
  if (value === null) return selected.includes("unknown");
  return selected.some((s) => s.toLowerCase() === value.toLowerCase());
}

/**
 * Any-overlap for array-valued fields (sectors, tags, countries).
 *
 * An empty array is unknown, and — same rule as the scalar facets — it is
 * selectable rather than invisible. 76 of the pool have no recorded
 * sector; "show me those" is a legitimate question, and the one an
 * officer asks when deciding what to send for analysis next.
 */
function overlap(selected: string[], values: string[]): boolean {
  if (!selected.length) return true;
  if (values.length === 0) return selected.includes(UNKNOWN);
  const have = new Set(values.map((v) => v.toLowerCase()));
  return selected.some((s) => have.has(s.toLowerCase()));
}

export function matchesFilters(row: SolutionRow, f: SolutionFilters): boolean {
  if (f.status !== "any" && row.status !== f.status) return false;

  if (f.fit === "matchable" && !row.matchable) return false;
  if (f.fit === "held" && row.matchable) return false;

  if (f.gov === "yes" && row.govExperience !== true) return false;
  if (f.gov === "no" && row.govExperience !== false) return false;
  if (f.gov === "unknown" && row.govExperience !== null) return false;

  if (f.backing === "verified" && row.backing !== true) return false;
  if (f.backing === "none" && row.backing !== false) return false;
  if (f.backing === "unknown" && row.backing !== null) return false;

  if (!overlap(f.sector, row.sectors)) return false;
  if (!overlap(f.sdg, row.sdgTags)) return false;
  if (!overlap(f.tech, row.techTypes)) return false;
  if (!facetMatch(f.hq, row.hqCountry)) return false;
  if (!overlap(f.active, row.countriesActive)) return false;
  if (!overlap(f.region, row.regions)) return false;
  if (!facetMatch(f.poc, row.pocStatus)) return false;
  if (!facetMatch(f.infra, row.infraIntensity)) return false;
  if (f.readiness.length && !f.readiness.includes(readinessBand(row.readiness)))
    return false;
  if (!facetMatch(f.confidence, row.confidence)) return false;
  if (f.funding.length && !f.funding.includes(fundingBand(row.fundingUsd)))
    return false;
  if (f.team.length && !f.team.includes(teamBand(row.teamSize))) return false;
  if (f.source.length && !f.source.includes(row.source)) return false;
  if (f.ppp.length && !f.ppp.includes(row.pppBand)) return false;

  if (f.q) {
    const hay = [
      row.name,
      row.domain,
      row.tagline,
      row.description,
      row.profileText,
      row.sectors.join(" "),
      row.techTypes.join(" "),
      row.sdgTags.join(" "),
    ]
      .filter(Boolean)
      .join("\n")
      .toLowerCase();
    // Every word must appear somewhere; word order is irrelevant.
    for (const word of f.q.toLowerCase().split(/\s+/)) {
      if (!hay.includes(word)) return false;
    }
  }

  return true;
}

export function sortSolutions(rows: SolutionRow[], sort: string): SolutionRow[] {
  const byName = (a: SolutionRow, b: SolutionRow) => a.name.localeCompare(b.name);
  const sorted = [...rows];
  if (sort === "name") return sorted.sort(byName);
  if (sort === "newest") {
    return sorted.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() ||
        byName(a, b)
    );
  }
  if (sort === "ppp") {
    // Same shape as readiness: unassessable last, because a company
    // nobody has looked at is not a weak candidate, just an unknown one.
    return sorted.sort((a, b) => {
      if (a.pppScore === null && b.pppScore === null) return byName(a, b);
      if (a.pppScore === null) return 1;
      if (b.pppScore === null) return -1;
      return b.pppScore - a.pppScore || byName(a, b);
    });
  }
  // Default: readiness desc, unscored last — an unknown is less precise,
  // not worse, but a ranked list has to put it somewhere and the honest
  // place is after the measured ones.
  return sorted.sort((a, b) => {
    if (a.readiness === null && b.readiness === null) return byName(a, b);
    if (a.readiness === null) return 1;
    if (b.readiness === null) return -1;
    return b.readiness - a.readiness || byName(a, b);
  });
}

// ── The overview matrix ────────────────────────────────────────────────

/**
 * A dimension the matrix can pivot on. `values` returns the buckets a
 * startup belongs to — plural, because a company with three sectors
 * genuinely is in three of them. `param` is the filter key a cell click
 * writes, so every cell in the grid is reachable through the same rail
 * an officer could have driven by hand.
 */
export interface MatrixDimension {
  key: string;
  label: string;
  param: keyof SolutionFilters;
  /** Buckets this row falls in. Empty is impossible — unknown is a bucket. */
  values: (r: SolutionRow) => string[];
  /** Display label for a bucket. */
  format: (v: string) => string;
}

const orUnknown = (vs: string[]): string[] => (vs.length ? vs : [UNKNOWN]);
const titleish = (v: string) =>
  v === UNKNOWN ? "not recorded" : v.replace(/_/g, " ");

export const MATRIX_DIMENSIONS: MatrixDimension[] = [
  {
    key: "sector", label: "Sector", param: "sector",
    values: (r) => orUnknown(r.sectors.map((s) => s.toLowerCase())),
    format: titleish,
  },
  {
    key: "region", label: "Region", param: "region",
    values: (r) => orUnknown(r.regions),
    format: (v) => (v === UNKNOWN ? "not recorded" : v),
  },
  {
    key: "tech", label: "Technology", param: "tech",
    values: (r) => orUnknown(r.techTypes.map((s) => s.toLowerCase())),
    format: titleish,
  },
  {
    key: "sdg", label: "SDG", param: "sdg",
    values: (r) => orUnknown(r.sdgTags.map((s) => s.toUpperCase())),
    format: (v) => (v === UNKNOWN ? "not recorded" : v),
  },
  {
    key: "hq", label: "HQ country", param: "hq",
    values: (r) => [r.hqCountry ?? UNKNOWN],
    format: (v) => (v === UNKNOWN ? "not recorded" : v),
  },
  {
    key: "active", label: "Active in", param: "active",
    values: (r) => orUnknown(r.countriesActive),
    format: (v) => (v === UNKNOWN ? "not recorded" : v),
  },
  {
    key: "poc", label: "Proof of concept", param: "poc",
    values: (r) => [r.pocStatus ?? UNKNOWN],
    format: titleish,
  },
  {
    key: "infra", label: "Infrastructure", param: "infra",
    values: (r) => [r.infraIntensity ?? UNKNOWN],
    format: titleish,
  },
  {
    key: "readiness", label: "Readiness", param: "readiness",
    values: (r) => [readinessBand(r.readiness)],
    format: (v) =>
      READINESS_BANDS.find((b) => b.key === v)?.label ?? titleish(v),
  },
  {
    key: "confidence", label: "Data confidence", param: "confidence",
    values: (r) => [r.confidence ?? UNKNOWN],
    format: (v) => (v === UNKNOWN ? "not assessed" : v),
  },
  {
    key: "status", label: "Pool status", param: "status",
    values: (r) => [r.status],
    format: titleish,
  },
  {
    key: "source", label: "How we found them", param: "source",
    values: (r) => [r.source],
    format: titleish,
  },
  {
    key: "ppp", label: "PPP readiness", param: "ppp",
    values: (r) => [r.pppBand],
    format: (v) =>
      ({ ready: "PPP ready", approaching: "approaching", pilot_first: "pilot first", unassessed: "not assessable" })[v] ?? v,
  },
  {
    key: "gov", label: "Government experience", param: "gov",
    values: (r) => [r.govExperience === null ? UNKNOWN : r.govExperience ? "yes" : "no"],
    format: (v) => (v === UNKNOWN ? "not recorded" : v),
  },
];

export function matrixDimension(key: string): MatrixDimension {
  return MATRIX_DIMENSIONS.find((d) => d.key === key) ?? MATRIX_DIMENSIONS[0];
}

/**
 * Cell key. NUL rather than a space because axis values contain spaces
 * ("East Asia"), which would make `sector + " " + region` ambiguous —
 * and silently so, which is worse.
 */
export function cellKey(rowValue: string, colValue: string): string {
  return `${rowValue} ${colValue}`;
}

export interface MatrixAxis {
  value: string;
  label: string;
  /** Distinct startups in this row/column — NOT the sum of its cells. */
  total: number;
}

export interface Matrix {
  rows: MatrixAxis[];
  cols: MatrixAxis[];
  /** Counts by `${rowValue} ${colValue}`. Absent means zero. */
  cells: Record<string, number>;
  /** Distinct startups counted overall. */
  total: number;
  /** Largest single cell, for heat scaling. */
  max: number;
  /** True when axes were capped and some buckets are not shown. */
  rowsTruncated: boolean;
  colsTruncated: boolean;
  /** True when any startup occupies more than one cell. */
  multiCounted: boolean;
}

const MAX_ROWS = 18;
const MAX_COLS = 12;

/**
 * Cross-tabulate the given rows.
 *
 * Totals are distinct startup counts while cells are memberships, so a
 * row's cells can sum higher than its total — a company working in four
 * countries is one startup in four columns. The alternative, picking a
 * "primary" sector or country, would be inventing a fact to make the
 * arithmetic tidy. The UI says which is which instead.
 *
 * Axes are capped by size, largest first, with unknown always kept: the
 * gap is the most informative bucket on the grid and must never be the
 * one that falls off the end.
 */
export function buildMatrix(
  rows: SolutionRow[],
  rowDim: MatrixDimension,
  colDim: MatrixDimension
): Matrix {
  const cells: Record<string, number> = {};
  const rowTotals = new Map<string, number>();
  const colTotals = new Map<string, number>();
  let multiCounted = false;

  for (const r of rows) {
    const rvs = [...new Set(rowDim.values(r))];
    const cvs = [...new Set(colDim.values(r))];
    if (rvs.length > 1 || cvs.length > 1) multiCounted = true;
    for (const rv of rvs) rowTotals.set(rv, (rowTotals.get(rv) ?? 0) + 1);
    for (const cv of cvs) colTotals.set(cv, (colTotals.get(cv) ?? 0) + 1);
    for (const rv of rvs) {
      for (const cv of cvs) {
        const k = cellKey(rv, cv);
        cells[k] = (cells[k] ?? 0) + 1;
      }
    }
  }

  const axis = (
    totals: Map<string, number>,
    dim: MatrixDimension,
    cap: number
  ): { axis: MatrixAxis[]; truncated: boolean } => {
    const all = [...totals.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
    );
    // Unknown earns its place regardless of rank, then sits last so the
    // known buckets read as the substance of the grid.
    const known = all.filter(([v]) => v !== UNKNOWN && v !== UNSCORED);
    const gap = all.filter(([v]) => v === UNKNOWN || v === UNSCORED);
    const keptKnown = known.slice(0, Math.max(1, cap - gap.length));
    const kept = [...keptKnown, ...gap];
    return {
      axis: kept.map(([value, total]) => ({
        value,
        label: dim.format(value),
        total,
      })),
      truncated: known.length > keptKnown.length,
    };
  };

  const r = axis(rowTotals, rowDim, MAX_ROWS);
  const c = axis(colTotals, colDim, MAX_COLS);

  return {
    rows: r.axis,
    cols: c.axis,
    cells,
    total: rows.length,
    max: Math.max(0, ...Object.values(cells)),
    rowsTruncated: r.truncated,
    colsTruncated: c.truncated,
    multiCounted,
  };
}

/**
 * How much of this set we actually know, per signal. The pool is mostly
 * un-analysed hunt findings, and a distribution chart that does not say
 * so invites an officer to read confidence into thin air.
 */
export interface Coverage {
  total: number;
  vetted: number;
  bars: { label: string; known: number }[];
}

export function coverageOf(rows: SolutionRow[]): Coverage {
  const count = (p: (r: SolutionRow) => boolean) => rows.filter(p).length;
  return {
    total: rows.length,
    vetted: count((r) => r.status === "approved"),
    bars: [
      { label: "Sector recorded", known: count((r) => r.sectors.length > 0) },
      { label: "Proof of concept known", known: count((r) => r.pocStatus !== null) },
      { label: "Readiness scored", known: count((r) => r.readiness !== null) },
      { label: "Analysed (embedded)", known: count((r) => r.profileText !== null) },
    ],
  };
}

/** Serialize filters back to a query string, for cell links. */
export function toQuery(f: SolutionFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.status !== "approved") p.set("status", f.status);
  for (const k of ["fit", "gov", "backing", "sort"] as const) {
    if (f[k]) p.set(k, f[k]);
  }
  for (const k of [
    "sector", "sdg", "tech", "hq", "active", "region",
    "poc", "infra", "readiness", "confidence", "funding", "team", "source", "ppp",
  ] as const) {
    for (const v of f[k]) p.append(k, v);
  }
  return p;
}

/**
 * The href for one cell: current filters, with the two matrix dimensions
 * SET (not appended) to the clicked bucket, so the list below matches
 * the number the officer just clicked.
 */
export function cellHref(
  filters: SolutionFilters,
  rowDim: MatrixDimension,
  rowValue: string,
  colDim: MatrixDimension,
  colValue: string
): string {
  const p = toQuery(filters);
  p.set("row", rowDim.key);
  p.set("col", colDim.key);
  for (const [dim, value] of [
    [rowDim, rowValue],
    [colDim, colValue],
  ] as const) {
    p.delete(dim.param);
    p.set(dim.param, value);
  }
  // Selecting a status bucket must not be masked by the default.
  if (rowDim.param === "status" || colDim.param === "status") {
    p.set("status", rowDim.param === "status" ? rowValue : colValue);
  }
  return `?${p.toString()}`;
}

export interface FacetOptions {
  sectors: string[];
  sdgs: string[];
  techs: string[];
  hqs: string[];
  actives: string[];
  regions: string[];
  sources: string[];
}

/** Distinct values present in the data, so the rail never offers a dead
 * checkbox. Sorted for stable rendering. */
export function facetOptions(rows: SolutionRow[]): FacetOptions {
  const collect = (get: (r: SolutionRow) => string[]): string[] => {
    const set = new Set<string>();
    for (const r of rows) for (const v of get(r)) if (v) set.add(v);
    return [...set].sort();
  };
  return {
    sectors: collect((r) => r.sectors.map((s) => s.toLowerCase())),
    sdgs: collect((r) => r.sdgTags.map((s) => s.toUpperCase())),
    techs: collect((r) => r.techTypes.map((s) => s.toLowerCase())),
    hqs: collect((r) => (r.hqCountry ? [r.hqCountry] : [])),
    actives: collect((r) => r.countriesActive),
    regions: collect((r) => r.regions),
    sources: collect((r) => [r.source]),
  };
}
