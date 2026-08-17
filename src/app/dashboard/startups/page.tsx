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
  buildMatrix,
  coverageOf,
  matrixDimension,
  cellHref,
  cellKey,
  toQuery,
  MATRIX_DIMENSIONS,
  READINESS_BANDS,
  FUNDING_BANDS,
  TEAM_BANDS,
  UNKNOWN,
  type SolutionRow,
  type SolutionFilters,
  type Matrix,
  type MatrixDimension,
  type Coverage,
} from "@/lib/solutions";
import { computePppReadiness, pppWeightsFrom, PPP_BANDS } from "@/lib/scoring/ppp";
import { ConfidenceChip, StatusChip, PppChip, PageTitle } from "../bits";

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
  const params = await searchParams;
  const filters = parseFilters(params);
  // Pivot choice is view state, not a filter — it never narrows anything.
  const pick = (v: string | string[] | undefined) =>
    (Array.isArray(v) ? v[0] : v) ?? "";
  const rowDim = matrixDimension(pick(params.row) || "sector");
  const colDim = matrixDimension(pick(params.col) || "region");

  const [{ data, error }, { data: regionRows }, { data: verifiedRows },
         { data: pilotRows }, { data: configRow }] =
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
      // Our own completed pilots are the highest-provenance PPP signal
      // available: we set the objectives and we recorded the result.
      sb
        .from("pilots")
        .select("outcome, matches(startup_id)")
        .eq("status", "completed")
        .not("outcome", "is", null),
      sb.from("scoring_config").select("ppp_weights").single(),
    ]);
  if (error) throw new Error(error.message);

  const regionOf = new Map(
    (regionRows ?? []).map((r) => [r.country as string, r.region as string])
  );
  const verifiedBacked = new Set((verifiedRows ?? []).map((r) => r.startup_id as string));

  // Best outcome per startup — one good pilot is the evidence, and a
  // later disappointing one does not erase a proven delivery.
  const RANK = { met_objectives: 3, partial: 2, not_met: 1 } as const;
  type Outcome = keyof typeof RANK;
  const pilotOutcome = new Map<string, Outcome>();
  for (const row of (pilotRows ?? []) as unknown as {
    outcome: Outcome;
    matches: { startup_id: string } | { startup_id: string }[] | null;
  }[]) {
    const m = Array.isArray(row.matches) ? row.matches[0] : row.matches;
    if (!m?.startup_id || !row.outcome) continue;
    const prior = pilotOutcome.get(m.startup_id);
    if (!prior || RANK[row.outcome] > RANK[prior]) {
      pilotOutcome.set(m.startup_id, row.outcome);
    }
  }
  const pppWeights = pppWeightsFrom(
    (configRow as { ppp_weights?: unknown } | null)?.ppp_weights
  );

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

    const fundingUsd =
      p?.funding_raised_usd == null ? null : Number(p.funding_raised_usd);
    const backing = verifiedBacked.has(s.id)
      ? true
      : p?.affiliations_confirmed_none
        ? false
        : null;
    const ppp = computePppReadiness(
      {
        gov_experience: p?.gov_experience ?? null,
        poc_status: p?.poc_status ?? null,
        infra_intensity: p?.infra_intensity ?? null,
        funding_raised_usd: fundingUsd,
        team_size: p?.team_size ?? null,
        backing,
        countries_active: active,
        pilot_outcome: pilotOutcome.get(s.id) ?? null,
      },
      pppWeights
    );

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
      backing,
      fundingUsd,
      teamSize: p?.team_size ?? null,
      hasMetrics: Boolean(p?.metrics && Object.keys(p.metrics).length),
      profileText: p?.profile_text ?? null,
      pppScore: ppp.score,
      pppBand: ppp.band,
    };
  });

  const options = facetOptions(rows);
  const matched = sortSolutions(rows.filter((r) => matchesFilters(r, filters)), filters.sort);
  const narrowing = activeFilterCount(filters);
  // The overview describes exactly what the list below contains — no
  // second, differently-scoped number for the officer to reconcile.
  const coverage = coverageOf(matched);
  const matrix = buildMatrix(matched, rowDim, colDim);

  return (
    <div>
      <PageTitle
        title="Solutions menu"
        sub="A menu of innovative solutions for development challenges — narrow it to the ones that fit."
      />

      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[230px_1fr]">
        {/* ── The filter rail — one GET form, shareable URLs ─────────── */}
        <form method="get" className="lg:sticky lg:top-8 lg:self-start">
          {/* The pivot is view state; the rail must not reset it. */}
          <input type="hidden" name="row" value={rowDim.key} />
          <input type="hidden" name="col" value={colDim.key} />
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

          <FacetGroup label="PPP readiness" name="ppp" selected={filters.ppp}
            options={PPP_BANDS.map((b) => [b.key, b.label] as [string, string])} />

          <FacetGroup label="Sector" name="sector" selected={filters.sector}
            options={[...options.sectors.map((v) => [v, v] as [string, string]),
                      [UNKNOWN, "not recorded"]]} />
          <FacetGroup label="SDG" name="sdg" selected={filters.sdg}
            options={[...options.sdgs.map((v) => [v, v] as [string, string]),
                      [UNKNOWN, "not recorded"]]} />
          <FacetGroup label="Technology" name="tech" selected={filters.tech}
            options={[...options.techs.map((v) => [v, v.replace(/_/g, " ")] as [string, string]),
                      [UNKNOWN, "not recorded"]]} />

          <FacetGroup label="Active in" name="active" selected={filters.active}
            options={[...options.actives.map((v) => [v, countryName(v)] as [string, string]),
                      [UNKNOWN, "not recorded"]]} />
          <FacetGroup label="Region" name="region" selected={filters.region}
            options={[...options.regions.map((v) => [v, v] as [string, string]),
                      [UNKNOWN, "not recorded"]]} />
          <FacetGroup label="HQ country" name="hq" selected={filters.hq}
            options={[...options.hqs.map((v) => [v, countryName(v)] as [string, string]),
                      [UNKNOWN, "not recorded"]]} />

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
              ["ppp", "PPP readiness, highest first"],
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
          <Overview
            coverage={coverage}
            matrix={matrix}
            filters={filters}
            rowDim={rowDim}
            colDim={colDim}
          />

          <p className="mt-10 text-xs uppercase tracking-wider text-ink-faint">
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

/**
 * The overview: how much we actually know, then a cross-tab of what we
 * have. Placed above the list because a distribution is a better first
 * question than a scroll — and because with most of the pool
 * un-analysed, the coverage strip is the context every number below it
 * needs.
 */
function Overview({
  coverage,
  matrix,
  filters,
  rowDim,
  colDim,
}: {
  coverage: Coverage;
  matrix: Matrix;
  filters: SolutionFilters;
  rowDim: MatrixDimension;
  colDim: MatrixDimension;
}) {
  if (coverage.total === 0) return null;
  const pct = (n: number) => Math.round((100 * n) / coverage.total);

  return (
    <section className="animate-rise border border-line bg-surface p-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-2xl tabular-nums tracking-tight text-ink">
          {coverage.total}
        </span>
        <span className="text-sm text-ink">
          solution{coverage.total === 1 ? "" : "s"} in view
        </span>
        <span className="text-xs text-ink-secondary">
          · {coverage.vetted} vetted
        </span>
      </div>

      {/* What we actually know. A distribution without this reads as more
          certain than it is. */}
      <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
        {coverage.bars.map((b) => (
          <div key={b.label}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[11px] text-ink-secondary">{b.label}</span>
              <span className="font-mono text-[11px] tabular-nums text-ink">
                {b.known}
                <span className="text-ink-faint">/{coverage.total}</span>
              </span>
            </div>
            <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-line">
              <div
                className="h-full rounded-full bg-forest"
                style={{ width: `${pct(b.known)}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Pivot. A GET form so the choice lives in the URL like everything
          else on this page. */}
      <form method="get" className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
        {[...toQuery(filters).entries()].map(([k, v], i) => (
          <input key={`${k}-${i}`} type="hidden" name={k} value={v} />
        ))}
        <span className="text-[11px] font-medium uppercase tracking-wider text-ink-secondary">
          Break down by
        </span>
        <select
          name="row"
          defaultValue={rowDim.key}
          className="border border-line bg-surface px-2 py-1 text-sm"
        >
          {MATRIX_DIMENSIONS.map((d) => (
            <option key={d.key} value={d.key}>{d.label}</option>
          ))}
        </select>
        <span className="text-sm text-ink-faint">×</span>
        <select
          name="col"
          defaultValue={colDim.key}
          className="border border-line bg-surface px-2 py-1 text-sm"
        >
          {MATRIX_DIMENSIONS.map((d) => (
            <option key={d.key} value={d.key}>{d.label}</option>
          ))}
        </select>
        <button className="border border-line px-2.5 py-1 text-xs text-ink-secondary hover:bg-well">
          Pivot
        </button>
      </form>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-surface px-2 py-1.5 text-left text-[11px] font-medium uppercase tracking-wider text-ink-secondary">
                {rowDim.label}
              </th>
              {matrix.cols.map((c) => (
                <th
                  key={c.value}
                  className="px-2 py-1.5 text-right text-[11px] font-medium text-ink-secondary"
                  title={`${c.label} — ${c.total} startup${c.total === 1 ? "" : "s"}`}
                >
                  <span className={c.value === UNKNOWN ? "italic text-ink-faint" : ""}>
                    {c.label}
                  </span>
                </th>
              ))}
              <th className="px-2 py-1.5 text-right text-[11px] font-medium uppercase tracking-wider text-ink-faint">
                All
              </th>
            </tr>
          </thead>
          <tbody>
            {matrix.rows.map((r) => (
              <tr key={r.value} className="border-t border-line">
                <th
                  scope="row"
                  className={`sticky left-0 z-10 bg-surface px-2 py-1.5 text-left text-xs font-normal ${
                    r.value === UNKNOWN ? "italic text-ink-faint" : "text-ink"
                  }`}
                >
                  {r.label}
                </th>
                {matrix.cols.map((c) => {
                  const n = matrix.cells[cellKey(r.value, c.value)] ?? 0;
                  return (
                    <td key={c.value} className="p-0 text-right">
                      {n > 0 ? (
                        <Link
                          href={cellHref(filters, rowDim, r.value, colDim, c.value)}
                          className="block px-2 py-1.5 font-mono text-xs tabular-nums text-ink transition-colors duration-150 hover:bg-forest hover:text-white"
                          style={{
                            // Heat, not decoration: where the pool is thick.
                            backgroundColor:
                              matrix.max > 0
                                ? `color-mix(in srgb, var(--color-forest-tint) ${Math.round(
                                    (100 * n) / matrix.max
                                  )}%, transparent)`
                                : undefined,
                          }}
                          title={`${r.label} × ${c.label} — ${n} startup${n === 1 ? "" : "s"}`}
                        >
                          {n}
                        </Link>
                      ) : (
                        <span
                          className="block px-2 py-1.5 font-mono text-xs text-ink-faint"
                          title={`No startups in ${r.label} × ${c.label}`}
                        >
                          —
                        </span>
                      )}
                    </td>
                  );
                })}
                <td className="px-2 py-1.5 text-right font-mono text-xs tabular-nums text-ink-secondary">
                  {r.total}
                </td>
              </tr>
            ))}
            <tr className="border-t border-line-strong">
              <th
                scope="row"
                className="sticky left-0 z-10 bg-surface px-2 py-1.5 text-left text-[11px] font-medium uppercase tracking-wider text-ink-faint"
              >
                All
              </th>
              {matrix.cols.map((c) => (
                <td
                  key={c.value}
                  className="px-2 py-1.5 text-right font-mono text-xs tabular-nums text-ink-secondary"
                >
                  {c.total}
                </td>
              ))}
              <td className="px-2 py-1.5 text-right font-mono text-xs tabular-nums text-ink">
                {matrix.total}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
        Click any number to filter the list to it. A dash is a real gap — nothing
        in the pool sits there.
        {matrix.multiCounted && (
          <>
            {" "}
            Totals count each startup once; cells count memberships, so a company
            with several sectors or countries appears in each and rows can sum
            higher than their total.
          </>
        )}
        {(matrix.rowsTruncated || matrix.colsTruncated) && (
          <>
            {" "}
            Showing the largest{" "}
            {[
              matrix.rowsTruncated ? `${matrix.rows.length} ${rowDim.label.toLowerCase()} values` : null,
              matrix.colsTruncated ? `${matrix.cols.length} ${colDim.label.toLowerCase()} values` : null,
            ]
              .filter(Boolean)
              .join(" and ")}{" "}
            — narrow the filters to see the rest.
          </>
        )}
      </p>
    </section>
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
            <PppChip band={r.pppBand} score={r.pppScore} />
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
