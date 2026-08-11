import {
  type ProvenanceRank,
  VERIFIED_RANKS,
} from "@/lib/provenance";

/**
 * base_readiness per SPEC "SCORING" + patch 1.
 *
 * The NULL vs ZERO rule, applied everywhere:
 *   NULL  = unknown → the signal's max drops OUT of the denominator.
 *   false / confirmed 0 → scores 0 INSIDE the denominator.
 *
 * base_readiness = round(100 * earned / sum_of_max_of_KNOWN_signals)
 * across SIX signals (gov, PoC, infra, institutional, funding, team).
 * PoC and infra normalize as two independent signals, never a composite.
 * Zero known signals → NULL, never 0. Stage is never scored.
 */

export type SignalKey =
  | "gov_experience"
  | "poc"
  | "infra"
  | "institutional_backing"
  | "funding"
  | "team_size";

export interface ReadinessSignal {
  key: SignalKey;
  known: boolean;
  earned: number;
  max: number;
  provenance: ProvenanceRank | null;
}

export interface ReadinessResult {
  score: number | null;
  signals: ReadinessSignal[];
  knownCount: number;
}

interface Tier {
  gt?: number;
  gte?: number;
  eq?: number;
  points: number;
}

/** Shape of scoring_config.readiness_weights (seeded in Phase 1). */
export interface ReadinessWeights {
  gov_experience: number;
  poc: { deployed_in_field: number; pilot_completed: number; max: number };
  infra: { plug_and_play: number; moderate: number; max: number };
  institutional_backing: number;
  funding: { tiers: Tier[]; max: number };
  team_size: { tiers: Tier[]; max: number };
}

export interface ProfileForScoring {
  gov_experience: boolean | null;
  poc_status: "none" | "pilot_completed" | "deployed_in_field" | null;
  infra_intensity: "plug_and_play" | "moderate" | "heavy" | null;
  funding_raised_usd: number | string | null;
  team_size: number | null;
  affiliations_confirmed_none: boolean;
  field_provenance: Record<string, string> | null;
}

function tierPoints(tiers: Tier[], value: number): number {
  // First match wins, so walk tiers in descending threshold order
  // regardless of how the (dashboard-editable) config array is stored —
  // a reordered edit must not silently change scores.
  const sorted = [...tiers].sort(
    (a, b) =>
      (b.gt ?? b.gte ?? b.eq ?? -Infinity) - (a.gt ?? a.gte ?? a.eq ?? -Infinity)
  );
  for (const t of sorted) {
    if (t.gt !== undefined && value > t.gt) return t.points;
    if (t.gte !== undefined && value >= t.gte) return t.points;
    if (t.eq !== undefined && value === t.eq) return t.points;
  }
  return 0;
}

function prov(
  profile: ProfileForScoring,
  field: string
): ProvenanceRank | null {
  const p = profile.field_provenance?.[field];
  return (p as ProvenanceRank) ?? null;
}

export function computeBaseReadiness(
  profile: ProfileForScoring,
  verifiedAffiliationCount: number,
  w: ReadinessWeights
): ReadinessResult {
  const signals: ReadinessSignal[] = [];

  // 1. Government experience — boolean, NULL means unknown.
  {
    const known = profile.gov_experience !== null;
    signals.push({
      key: "gov_experience",
      known,
      earned: known && profile.gov_experience ? w.gov_experience : 0,
      max: w.gov_experience,
      provenance: prov(profile, "gov_experience"),
    });
  }

  // 2. PoC — independent signal; confirmed 'none' is a known zero.
  {
    const s = profile.poc_status;
    const known = s !== null;
    const earned =
      s === "deployed_in_field"
        ? w.poc.deployed_in_field
        : s === "pilot_completed"
          ? w.poc.pilot_completed
          : 0;
    signals.push({
      key: "poc",
      known,
      earned: known ? earned : 0,
      max: w.poc.max,
      provenance: prov(profile, "poc_status"),
    });
  }

  // 3. Infra intensity — independent signal; confirmed 'heavy' is a known zero.
  {
    const s = profile.infra_intensity;
    const known = s !== null;
    const earned =
      s === "plug_and_play"
        ? w.infra.plug_and_play
        : s === "moderate"
          ? w.infra.moderate
          : 0;
    signals.push({
      key: "infra",
      known,
      earned: known ? earned : 0,
      max: w.infra.max,
      provenance: prov(profile, "infra_intensity"),
    });
  }

  // 4. Institutional backing — patch 5: known only when VERIFIED
  //    affiliations exist OR the founder/reviewer confirmed there are none.
  {
    const hasVerified = verifiedAffiliationCount > 0;
    const known = hasVerified || profile.affiliations_confirmed_none;
    signals.push({
      key: "institutional_backing",
      known,
      earned: hasVerified ? w.institutional_backing : 0,
      max: w.institutional_backing,
      provenance: hasVerified
        ? "reviewer_confirmed"
        : profile.affiliations_confirmed_none
          ? "founder_provided"
          : null,
    });
  }

  // 5. Funding — numeric tiers; confirmed 0 stays in the denominator.
  {
    const raw = profile.funding_raised_usd;
    const known = raw !== null;
    const value = known ? Number(raw) : 0;
    signals.push({
      key: "funding",
      known,
      earned: known ? tierPoints(w.funding.tiers, value) : 0,
      max: w.funding.max,
      provenance: prov(profile, "funding_raised_usd"),
    });
  }

  // 6. Team size.
  {
    const known = profile.team_size !== null;
    signals.push({
      key: "team_size",
      known,
      earned: known ? tierPoints(w.team_size.tiers, profile.team_size!) : 0,
      max: w.team_size.max,
      provenance: prov(profile, "team_size"),
    });
  }

  const knownSignals = signals.filter((s) => s.known);
  const denominator = knownSignals.reduce((sum, s) => sum + s.max, 0);
  const earned = knownSignals.reduce((sum, s) => sum + s.earned, 0);

  return {
    score:
      knownSignals.length === 0 || denominator === 0
        ? null
        : Math.round((100 * earned) / denominator),
    signals,
    knownCount: knownSignals.length,
  };
}

/**
 * data_confidence derives from the provenance mix and verified-signal
 * count. It is DISPLAYED beside scores ("LOW (2 of 6 signals)") and never
 * blended into any score.
 */
export interface ConfidenceResult {
  level: "high" | "medium" | "low";
  verifiedCount: number;
  totalSignals: number;
}

export function deriveDataConfidence(
  signals: ReadinessSignal[]
): ConfidenceResult {
  const verifiedCount = signals.filter(
    (s) =>
      s.known && s.provenance !== null && VERIFIED_RANKS.has(s.provenance)
  ).length;
  return {
    level: verifiedCount >= 5 ? "high" : verifiedCount >= 3 ? "medium" : "low",
    verifiedCount,
    totalSignals: signals.length,
  };
}
