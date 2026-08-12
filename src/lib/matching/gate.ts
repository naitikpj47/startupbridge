import { VERIFIED_RANKS, type ProvenanceRank, type ReviewFlag } from "@/lib/provenance";

/**
 * THE GATE — the deployability doctrine, in ONE shared function used by
 * every matching surface: match runs, adjacent fallbacks, and sourcing
 * suggestions all call this and nothing else.
 *
 * Excluded outright: poc_status 'none' OR infra_intensity 'heavy' (a
 * stated no-PoC or heavy-infra value excludes regardless of source — the
 * doctrine is conservative). Excluded startups stay 'approved' in the
 * pool; founder-facing copy reads "held until PoC confirmed".
 *
 * NULL on a gate field passes WITH a "verify before intro" flag.
 * Provenance strictness applies to gate fields only: a passing value
 * whose provenance is scraped or ai_inferred also passes flagged; a
 * clean pass requires founder_provided, premium_db, or
 * reviewer_confirmed.
 */

export interface GateProfile {
  poc_status: "none" | "pilot_completed" | "deployed_in_field" | null;
  infra_intensity: "plug_and_play" | "moderate" | "heavy" | null;
  field_provenance: Record<string, string> | null;
}

export interface GateResult {
  eligible: boolean;
  /** Internal exclusion causes for reviewers (empty when eligible). */
  exclusionReasons: string[];
  /** The ONE founder-facing string every surface must render for an
   * excluded startup (spec wording); null when eligible. */
  founderCopy: string | null;
  /** verify-before-intro flags to surface on the startup (patch 6). */
  verifyFlags: ReviewFlag[];
}

/** Spec-mandated founder-facing copy, defined once at the gate so no
 * surface re-implements (or mis-implements) it. */
export const HELD_COPY =
  "Held until PoC confirmed — submit proof-of-concept evidence " +
  "(pilot partner, location, results) to become matchable.";

const GATE_FIELDS = ["poc_status", "infra_intensity"] as const;

export function evaluateGate(profile: GateProfile): GateResult {
  const exclusionReasons: string[] = [];

  if (profile.poc_status === "none") {
    exclusionReasons.push("no proof of concept on record");
  }
  if (profile.infra_intensity === "heavy") {
    exclusionReasons.push("infrastructure intensity confirmed heavy");
  }
  if (exclusionReasons.length) {
    return {
      eligible: false,
      exclusionReasons,
      founderCopy: HELD_COPY,
      verifyFlags: [],
    };
  }

  const verifyFlags: ReviewFlag[] = [];
  for (const field of GATE_FIELDS) {
    const value = profile[field];
    if (value === null) {
      verifyFlags.push({
        type: "verify_before_intro",
        field,
        detail: `${field} is unknown — verify before any introduction`,
        raised_at: new Date().toISOString(),
      });
      continue;
    }
    const rank = profile.field_provenance?.[field] as ProvenanceRank | undefined;
    if (!rank || !VERIFIED_RANKS.has(rank)) {
      verifyFlags.push({
        type: "verify_before_intro",
        field,
        detail: `${field} ("${value}") comes from ${rank ?? "an unrecorded source"} — verify before any introduction`,
        raised_at: new Date().toISOString(),
      });
    }
  }

  return { eligible: true, exclusionReasons: [], founderCopy: null, verifyFlags };
}
