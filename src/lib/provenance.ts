/**
 * Field provenance: every substantive profile field records where its
 * value came from. Higher-or-equal rank may overwrite; lower never does.
 * One deliberate exception (spec): when premium_db contradicts
 * founder_provided we do NOT overwrite — we raise a review flag, because
 * the contradiction itself is information.
 */

export type ProvenanceRank =
  | "reviewer_confirmed"
  | "founder_provided"
  | "premium_db"
  | "scraped"
  | "ai_inferred";

const RANK_ORDER: Record<ProvenanceRank, number> = {
  reviewer_confirmed: 5,
  founder_provided: 4,
  premium_db: 3,
  scraped: 2,
  ai_inferred: 1,
};

/** Ranks trusted enough to count as "verified" for data_confidence and
 * for a clean pass through the gate's provenance strictness check. */
export const VERIFIED_RANKS: ReadonlySet<ProvenanceRank> = new Set([
  "reviewer_confirmed",
  "founder_provided",
  "premium_db",
]);

export function rankOf(rank: ProvenanceRank | undefined | null): number {
  return rank ? RANK_ORDER[rank] : 0;
}

export function canOverwrite(
  incoming: ProvenanceRank,
  existing: ProvenanceRank | undefined | null,
  existingValueIsNull: boolean
): boolean {
  // A null value is always fillable regardless of recorded provenance.
  if (existingValueIsNull) return true;
  // A value with unrecorded provenance is treated conservatively: only
  // verified-rank sources may replace it.
  if (!existing) return VERIFIED_RANKS.has(incoming);
  return rankOf(incoming) >= rankOf(existing);
}

export interface ReviewFlag {
  type: "provenance_conflict" | "verify_before_intro" | "affiliation_hint";
  field?: string;
  detail: string;
  raised_at: string;
}

/** premium_db contradicting founder_provided → flag, never overwrite. */
export function conflictFlag(
  field: string,
  incoming: ProvenanceRank,
  existing: ProvenanceRank | undefined | null,
  incomingValue: unknown,
  existingValue: unknown
): ReviewFlag | null {
  if (
    incoming === "premium_db" &&
    existing === "founder_provided" &&
    existingValue !== null &&
    JSON.stringify(incomingValue) !== JSON.stringify(existingValue)
  ) {
    return {
      type: "provenance_conflict",
      field,
      detail: `premium_db reports ${JSON.stringify(
        incomingValue
      )} but founder provided ${JSON.stringify(existingValue)}`,
      raised_at: new Date().toISOString(),
    };
  }
  return null;
}
