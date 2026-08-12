/**
 * context_fit, strategic_fit, and final_score composition.
 *
 * Patch 3 — context_fit applies the NULL rule to its own sub-signals
 * (geography 40/25, sector 35, SDG 25): unknown sub-signals drop from
 * its denominator; all unknown → context_fit NULL.
 *
 * Patch 2 — final score: similarity, base_readiness, and context_fit are
 * EVIDENCE components; a NULL one renormalizes across the known evidence
 * weights. strategic_fit is a POLICY component, never renormalized:
 * unknown hq_country takes the default weight (0) and its 0.15 weight
 * ALWAYS stays in the denominator. Never zero-fill a NULL evidence
 * component.
 */

export interface ContextWeights {
  geo_country_active: number; // 40
  geo_same_region: number; // 25
  sector_overlap: number; // 35
  sdg_overlap: number; // 25
}

export interface ProblemForContext {
  country: string | null;
  sector: string | null;
  sdg_tags: string[] | null;
}

export interface ProfileForContext {
  countries_active: string[] | null;
  sdg_tags: string[] | null;
  sectors: string[] | null;
}

export function computeContextFit(
  problem: ProblemForContext,
  profile: ProfileForContext,
  w: ContextWeights,
  regionOf: (iso: string) => string | undefined
): number | null {
  let earned = 0;
  let denominator = 0;

  // Geography: in countries_active → 40; same region → 25; else 0.
  const geoKnown =
    problem.country !== null && (profile.countries_active?.length ?? 0) > 0;
  if (geoKnown) {
    denominator += w.geo_country_active;
    const active = profile.countries_active!.map((c) => c.toUpperCase());
    const target = problem.country!.toUpperCase();
    if (active.includes(target)) {
      earned += w.geo_country_active;
    } else {
      const targetRegion = regionOf(target);
      if (
        targetRegion !== undefined &&
        active.some((c) => regionOf(c) === targetRegion)
      ) {
        earned += w.geo_same_region;
      }
    }
  }

  // Sector: binary overlap between the problem's sector and the
  // startup's sector tags.
  const sectorKnown =
    problem.sector !== null && (profile.sectors?.length ?? 0) > 0;
  if (sectorKnown) {
    denominator += w.sector_overlap;
    const sectors = profile.sectors!.map((s) => s.toLowerCase());
    if (sectors.includes(problem.sector!.toLowerCase())) {
      earned += w.sector_overlap;
    }
  }

  // SDG: fraction of the problem's SDGs the startup covers.
  const sdgKnown =
    (problem.sdg_tags?.length ?? 0) > 0 && (profile.sdg_tags?.length ?? 0) > 0;
  if (sdgKnown) {
    denominator += w.sdg_overlap;
    const startupSdgs = new Set(profile.sdg_tags!.map((s) => s.toUpperCase()));
    const covered = problem.sdg_tags!.filter((s) =>
      startupSdgs.has(s.toUpperCase())
    ).length;
    earned += w.sdg_overlap * (covered / problem.sdg_tags!.length);
  }

  if (denominator === 0) return null;
  return Math.round((100 * earned) / denominator);
}

/**
 * strategic_fit — country_weights applied to hq_country only, normalized
 * weight/max*100. UI label everywhere: "Partnership priority"; never a
 * per-startup badge. Unknown hq → the default weight.
 */
export function computeStrategicFit(
  hqCountry: string | null,
  countryWeights: Record<string, number>
): number {
  // Config is dashboard-editable: normalize key case, include the default
  // weight in the max, and clamp — this function is the sole enforcement
  // point of the DB's 0-100 check constraint.
  let defaultWeight = 0;
  const named: Record<string, number> = {};
  for (const [key, value] of Object.entries(countryWeights)) {
    if (key.toLowerCase() === "default") defaultWeight = value;
    else named[key.toUpperCase()] = value;
  }
  const maxWeight = Math.max(defaultWeight, ...Object.values(named), 0);
  if (maxWeight <= 0) return 0;
  const weight =
    hqCountry !== null
      ? (named[hqCountry.toUpperCase()] ?? defaultWeight)
      : defaultWeight;
  return Math.min(100, Math.max(0, Math.round((100 * weight) / maxWeight)));
}

export interface FinalScoreWeights {
  similarity: number; // 0.35
  readiness: number; // 0.30
  context: number; // 0.20
  strategic: number; // 0.15
}

export function computeFinalScore(
  similarity: number, // cosine similarity 0..1
  baseReadiness: number | null,
  contextFit: number | null,
  strategicFit: number, // policy component, always a number
  w: FinalScoreWeights
): number {
  // Patch 8 assertion: similarity must be a finite cosine SIMILARITY,
  // not a distance and not null/NaN — those must fail loudly, never
  // zero-fill (patch 2 forbids zero-filling a NULL evidence component).
  if (
    typeof similarity !== "number" ||
    !Number.isFinite(similarity) ||
    similarity < -1.0001 ||
    similarity > 1.0001
  ) {
    throw new Error(
      `similarity must be a finite number in [-1, 1], got ${similarity} — was a distance or NULL passed?`
    );
  }

  let numerator = w.similarity * (similarity * 100);
  let evidenceDenominator = w.similarity;

  if (baseReadiness !== null) {
    numerator += w.readiness * baseReadiness;
    evidenceDenominator += w.readiness;
  }
  if (contextFit !== null) {
    numerator += w.context * contextFit;
    evidenceDenominator += w.context;
  }

  // Policy component: never renormalized, denominator always includes it.
  numerator += w.strategic * strategicFit;
  const denominator = evidenceDenominator + w.strategic;

  return Math.round(numerator / denominator);
}
