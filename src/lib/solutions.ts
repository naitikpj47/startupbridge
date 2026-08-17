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
  sort: string; // readiness | newest | name
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
    "poc", "infra", "readiness", "confidence", "funding", "team", "source",
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

/** Any-overlap for array-valued fields (sectors, tags, countries). */
function overlap(selected: string[], values: string[]): boolean {
  if (!selected.length) return true;
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
