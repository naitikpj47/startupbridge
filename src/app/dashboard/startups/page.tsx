import Link from "next/link";
import { requireOfficer } from "@/lib/server/auth";
import { evaluateGate } from "@/lib/matching/gate";
import { countryName } from "@/lib/countries";
import {
  parseFilters,
  matchesFilters,
  sortSolutions,
  facetOptions,
  activeFilterCount,
  READINESS_BANDS,
  FUNDING_BANDS,
  TEAM_BANDS,
  type SolutionRow,
} from "@/lib/solutions";
import { ConfidenceChip, StatusChip, PageTitle } from "../bits";

export const dynamic = "force-dynamic";

/**
 * The solutions menu. The client's own words: "a menu of innovative
 * solutions for development challenges" — an officer browses and narrows
 * rather than searches and hopes.
 *
 * The pool is small enough (tens, not tens of thousands) to load whole
 * and filter in process, which is what makes the exhaustive facet rail
 * cheap: one query, every cross-cutting filter, no index planning. The
 * filter logic itself lives in src/lib/solutions.ts, pure and tested.
 *
 * Every facet that can be unknown offers "unknown" explicitly. Filtering
 * for deployed-in-field is a question about evidence; a profile without
 * evidence is a different answer, never a quiet inclusion.
 */
export default async function StartupsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { sb } = await requireOfficer();
  const filters = parseFilters(await searchParams);

  const [{ data, error }, { data: regionRows }, { data: verifiedRows }] =
    await Promise.all([
      sb
        .from("startups")
        .select(
          "id, name, domain, tagline, description, source, status, created_at, " +
            "startup_profiles(sectors, sdg_tags, tech_type, hq_country, countries_active, " +
            "poc_status, infra_intensity, base_readiness, data_confidence, gov_experience, " +
            "affiliations_confirmed_none, funding_raised_usd, team_size, metrics, profile_text, " +
            "field_provenance)"
        )
        .neq("status", "rejected"),
      sb.from("country_regions").select("country, region"),
      sb.from("affiliations").select("startup_id").eq("verified", true),
    ]);
  if (error) throw new Error(error.message);

  const regionOf = new Map(
    (regionRows ?? []).map((r) => [r.country as string, r.region as string])
  );
  const verifiedBacked = new Set((verifiedRows ?? []).map((r) => r.startup_id as string));

  // Concatenated select strings defeat supabase-js's literal type parser.
  const raw = (data ?? []) as unknown as {
    id: string;
    name: string;
    domain: string | null;
    tagline: string | null;
    description: string | null;
    source: string;
    status: string;
    created_at: string;
    startup_profiles: Record<string, unknown> | Record<string, unknown>[] | null;
  }[];

  const rows: SolutionRow[] = raw.map((s) => {
    const p = (Array.isArray(s.startup_profiles)
      ? s.startup_profiles[0]
      : s.startup_profiles) as {
      sectors: string[] | null;
      sdg_tags: string[] | null;
      tech_type: string[] | null;
      hq_country: string | null;
      countries_active: string[] | null;
      poc_status: "none" | "pilot_completed" | "deployed_in_field" | null;
      infra_intensity: "plug_and_play" | "moderate" | "heavy" | null;
      base_readiness: number | null;
      data_confidence: string | null;
      gov_experience: boolean | null;
      affiliations_confirmed_none: boolean;
      funding_raised_usd: number | string | null;
      team_size: number | null;
      metrics: Record<string, unknown> | null;
      profile_text: string | null;
      field_provenance: Record<string, string> | null;
    } | null;

    const active = p?.countries_active ?? [];
    const regionSources = p?.hq_country ? [p.hq_country, ...active] : active;
    const regions = [
      ...new Set(
        regionSources
          .map((c) => regionOf.get(c.toUpperCase()))
          .filter((r): r is string => Boolean(r))
      ),
    ];

    return {
      id: s.id,
      name: s.name,
      domain: s.domain,
      tagline: s.tagline,
      description: s.description,
      status: s.status,
      source: s.source,
      createdAt: s.created_at,
      matchable: p
        ? evaluateGate({
            poc_status: p.poc_status,
            infra_intensity: p.infra_intensity,
            field_provenance: p.field_provenance,
          }).eligible
        : true,
      sectors: p?.sectors ?? [],
      sdgTags: p?.sdg_tags ?? [],
      techTypes: p?.tech_type ?? [],
      hqCountry: p?.hq_country ?? null,
      countriesActive: active,
      regions,
      pocStatus: p?.poc_status ?? null,
      infraIntensity: p?.infra_intensity ?? null,
      readiness: p?.base_readiness ?? null,
      confidence: p?.data_confidence ?? null,
      govExperience: p?.gov_experience ?? null,
      backing: verifiedBacked.has(s.id)
        ? true
        : p?.affiliations_confirmed_none
          ? false
          : null,
      fundingUsd:
        p?.funding_raised_usd == null ? null : Number(p.funding_raised_usd),
      teamSize: p?.team_size ?? null,
      hasMetrics: Boolean(p?.metrics && Object.keys(p.metrics).length),
      profileText: p?.profile_text ?? null,
    };
  });

  const options = facetOptions(rows);
  const matched = sortSolutions(rows.filter((r) => matchesFilters(r, filters)), filters.sort);
  const narrowing = activeFilterCount(filters);

  return (
    <div>
      <PageTitle
        title="Solutions menu"
        sub="A menu of innovative solutions for development challenges — narrow it to the ones that fit."
      />

      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[230px_1fr]">
        {/* ── The filter rail — one GET form, shareable URLs ─────────── */}
        <form method="get" className="lg:sticky lg:top-8 lg:self-start">
          <input
            name="q"
            defaultValue={filters.q}
            placeholder="Search anything…"
            className="w-full border border-line bg-surface px-3 py-1.5 text-sm placeholder:text-ink-faint focus:border-forest focus:outline-none"
          />

          <FacetSelect
            label="Pool"
            name="status"
            value={filters.status}
            options={[
              ["approved", "Vetted pool (approved)"],
              ["any", "Any status"],
              ["under_review", "Under review"],
              ["submitted", "Just submitted"],
            ]}
          />
          <FacetSelect
            label="Deployability"
            name="fit"
            value={filters.fit}
            options={[
              ["", "Any"],
              ["matchable", "Matchable — clears the gate"],
              ["held", "Held until PoC confirmed"],
            ]}
          />

          <FacetGroup label="Sector" name="sector" selected={filters.sector}
            options={options.sectors.map((v) => [v, v])} />
          <FacetGroup label="SDG" name="sdg" selected={filters.sdg}
            options={options.sdgs.map((v) => [v, v])} />
          <FacetGroup label="Technology" name="tech" selected={filters.tech}
            options={options.techs.map((v) => [v, v.replace(/_/g, " ")])} />

          <FacetGroup label="Active in" name="active" selected={filters.active}
            options={options.actives.map((v) => [v, countryName(v)])} />
          <FacetGroup label="Region" name="region" selected={filters.region}
            options={options.regions.map((v) => [v, v])} />
          <FacetGroup label="HQ country" name="hq" selected={filters.hq}
            options={options.hqs.map((v) => [v, countryName(v)])} />

          <FacetGroup label="Proof of concept" name="poc" selected={filters.poc}
            options={[
              ["deployed_in_field", "Deployed in the field"],
              ["pilot_completed", "Pilot completed"],
              ["none", "No PoC yet"],
              ["unknown", "Unknown"],
            ]} />
          <FacetGroup label="Infrastructure need" name="infra" selected={filters.infra}
            options={[
              ["plug_and_play", "Plug and play"],
              ["moderate", "Moderate"],
              ["heavy", "Heavy"],
              ["unknown", "Unknown"],
            ]} />

          <FacetGroup label="Readiness" name="readiness" selected={filters.readiness}
            options={READINESS_BANDS.map((b) => [b.key, b.label])} />
          <FacetGroup label="Data confidence" name="confidence" selected={filters.confidence}
            options={[
              ["high", "High"],
              ["medium", "Medium"],
              ["low", "Low"],
              ["unknown", "Not assessed"],
            ]} />

          <FacetSelect
            label="Government experience"
            name="gov"
            value={filters.gov}
            options={[
              ["", "Any"],
              ["yes", "Confirmed yes"],
              ["no", "Confirmed no"],
              ["unknown", "Unknown"],
            ]}
          />
          <FacetSelect
            label="Institutional backing"
            name="backing"
            value={filters.backing}
            options={[
              ["", "Any"],
              ["verified", "Verified affiliation"],
              ["none", "Confirmed none"],
              ["unknown", "Unknown"],
            ]}
          />

          <FacetGroup label="Funding raised" name="funding" selected={filters.funding}
            options={FUNDING_BANDS.map((b) => [b.key, b.label])} />
          <FacetGroup label="Team size" name="team" selected={filters.team}
            options={TEAM_BANDS.map((b) => [b.key, b.label])} />
          <FacetGroup label="How we found them" name="source" selected={filters.source}
            options={options.sources.map((v) => [v, v.replace(/_/g, " ")])} />

          <FacetSelect
            label="Sort by"
            name="sort"
            value={filters.sort}
            options={[
              ["readiness", "Readiness, highest first"],
              ["newest", "Newest first"],
              ["name", "Name, A–Z"],
            ]}
          />

          <div className="mt-4 flex items-center gap-3">
            <button className="bg-forest px-4 py-1.5 text-sm font-medium text-white transition-colors duration-150 hover:bg-forest-deep">
              Apply
            </button>
            {narrowing > 0 && (
              <Link
                href="/dashboard/startups"
                className="text-xs text-ink-secondary underline-offset-2 hover:text-ink hover:underline"
              >
                Clear all ({narrowing})
              </Link>
            )}
          </div>
        </form>

        {/* ── The menu ───────────────────────────────────────────────── */}
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wider text-ink-faint">
            {matched.length} of {rows.length} solution{rows.length === 1 ? "" : "s"}
            {narrowing > 0 ? ` · ${narrowing} filter${narrowing > 1 ? "s" : ""} on` : ""}
          </p>

          <div className="mt-3 space-y-2">
            {matched.map((r) => (
              <SolutionCard key={r.id} row={r} />
            ))}
            {matched.length === 0 && (
              <div className="border border-line bg-surface px-8 py-12 text-center">
                <p className="font-display text-xl text-ink">
                  Nothing on the menu matches all of that.
                </p>
                <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-secondary">
                  Loosen a filter — or ask for the need on the{" "}
                  <Link href="/dashboard" className="text-forest underline underline-offset-2">
                    Ask screen
                  </Link>{" "}
                  and let the hunt search beyond the pool.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SolutionCard({ row: r }: { row: SolutionRow }) {
  return (
    <div className="animate-rise border border-line bg-surface p-4 transition-colors duration-150 hover:border-line-strong">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/dashboard/startups/${r.id}`}
              className="text-sm font-semibold text-ink underline-offset-2 hover:underline"
            >
              {r.name}
            </Link>
            {r.domain && <span className="text-xs text-ink-faint">{r.domain}</span>}
            {r.status !== "approved" && <StatusChip status={r.status} />}
            {!r.matchable && (
              <span className="rounded bg-warn-tint px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-warn">
                held
              </span>
            )}
          </div>
          {r.tagline && (
            <p className="mt-1 truncate text-sm text-ink-secondary">{r.tagline}</p>
          )}
          <p className="mt-1.5 text-xs text-ink-faint">
            {[
              r.sectors.join(", "),
              r.hqCountry ? `HQ ${countryName(r.hqCountry)}` : null,
              r.countriesActive.length
                ? `active: ${r.countriesActive.map(countryName).join(", ")}`
                : null,
              r.pocStatus ? `PoC: ${r.pocStatus.replace(/_/g, " ")}` : "PoC: unknown",
              r.infraIntensity
                ? `infra: ${r.infraIntensity.replace(/_/g, " ")}`
                : "infra: unknown",
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span
            className="font-mono text-xl tabular-nums tracking-tight text-ink"
            title="Base readiness"
          >
            {r.readiness ?? "—"}
          </span>
          <ConfidenceChip level={r.confidence} />
        </div>
      </div>
    </div>
  );
}

/** Collapsible checkbox facet. Open when anything in it is selected, so
 * an applied filter is always visible without hunting. */
function FacetGroup({
  label,
  name,
  options,
  selected,
}: {
  label: string;
  name: string;
  options: [value: string, label: string][];
  selected: string[];
}) {
  if (!options.length) return null;
  const on = new Set(selected.map((s) => s.toLowerCase()));
  return (
    <details open={selected.length > 0} className="mt-3 border-t border-line pt-2">
      <summary className="cursor-pointer select-none text-[11px] font-medium uppercase tracking-wider text-ink-secondary">
        {label}
        {selected.length > 0 && (
          <span className="ml-1.5 text-forest">({selected.length})</span>
        )}
      </summary>
      <div className="mt-1.5 max-h-44 space-y-1 overflow-y-auto pr-1">
        {options.map(([value, text]) => (
          <label key={value} className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              name={name}
              value={value}
              defaultChecked={on.has(value.toLowerCase())}
              className="h-3.5 w-3.5 accent-[#175a3c]"
            />
            <span className="truncate">{text}</span>
          </label>
        ))}
      </div>
    </details>
  );
}

function FacetSelect({
  label,
  name,
  value,
  options,
}: {
  label: string;
  name: string;
  value: string;
  options: [value: string, label: string][];
}) {
  return (
    <div className="mt-3 border-t border-line pt-2">
      <label className="block text-[11px] font-medium uppercase tracking-wider text-ink-secondary">
        {label}
      </label>
      <select
        name={name}
        defaultValue={value}
        className="mt-1 w-full border border-line bg-surface px-2 py-1 text-sm"
      >
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </div>
  );
}
