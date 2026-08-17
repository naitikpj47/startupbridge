/**
 * PPP readiness — can this company survive procurement and deliver at
 * commercial scale alongside a public counterpart?
 *
 * Deliberately NOT a re-weighting of base_readiness. That score answers
 * "can they deploy something": it is about a pilot. This one answers a
 * different question, and two of its signals invert:
 *
 *   Heavy infrastructure DISQUALIFIES a quick pilot — the gate excludes
 *   it outright — but heavy infrastructure is what public-private
 *   partnerships exist to build. Here it counts in a company's favour.
 *
 *   Operating across several jurisdictions is irrelevant to a single
 *   pilot and central to a PPP, because it is evidence a firm can pass
 *   more than one procurement regime. base_readiness does not look at
 *   it at all.
 *
 * The NULL-vs-ZERO rule applies exactly as it does everywhere else: an
 * unknown signal leaves the denominator instead of scoring zero, and a
 * company with nothing known scores NULL, never 0. Most of a scraped
 * pool will be NULL here, and "not assessable" is the honest label for
 * a company nobody has looked at yet.
 *
 * Weights live in scoring_config.ppp_weights, editable from the config
 * screen, because every other weight in this system does.
 */

export type PppSignalKey =
  | "gov_experience"
  | "field_deployment"
  | "pilot_evidence"
  | "delivery_capacity"
  | "financial_depth"
  | "institutional_backing"
  | "jurisdictions"
  | "infrastructure_fit";

export interface PppSignal {
  key: PppSignalKey;
  label: string;
  known: boolean;
  earned: number;
  max: number;
  /** One line an officer can read: why this signal scored what it did. */
  note: string;
}

export interface PppResult {
  score: number | null;
  band: PppBand;
  signals: PppSignal[];
  knownCount: number;
  /** Scored, but on too few signals to earn the top band. */
  thinEvidence: boolean;
}

export type PppBand = "ready" | "approaching" | "pilot_first" | "unassessed";

export interface PppWeights {
  gov_experience: number;
  field_deployment: number;
  pilot_evidence: number;
  delivery_capacity: number;
  financial_depth: number;
  institutional_backing: number;
  jurisdictions: number;
  infrastructure_fit: number;
  /** Score at or above which a company reads as PPP ready. */
  ready_at: number;
  /** Score at or above which it reads as approaching. */
  approaching_at: number;
  /**
   * How many signals must be known before the top band is available.
   *
   * The normalization is honest — 100 of what we know is 100 of what we
   * know — but a band is a claim, and "PPP ready" printed in green off a
   * single data point is exactly the unearned confidence the rest of
   * this system refuses. Readiness pairs its score with data_confidence
   * for the same reason; this is that guard, expressed as a floor.
   */
  min_signals_for_ready: number;
}

/**
 * Defaults, and the reasoning:
 *
 *  gov_experience 30 — the single best predictor. A firm that has never
 *      invoiced a public body has never met procurement, and that is
 *      where most PPP candidates fail.
 *  pilot_evidence 25 — our OWN completed pilot. Highest provenance
 *      available: we set the objectives and we recorded the result.
 *  field_deployment 15 — deployed beats piloted; a PPP scales something
 *      that already runs.
 *  financial_depth 12 — PPPs pay late and demand co-investment.
 *  delivery_capacity 8 — a five-person team cannot staff a national
 *      rollout, whatever the technology does.
 *  institutional_backing 5 — credibility with a public counterpart.
 *  jurisdictions 5 — evidence of clearing more than one regime.
 *  infrastructure_fit 5 — heavy infra is the PPP's natural domain.
 */
export const DEFAULT_PPP_WEIGHTS: PppWeights = {
  gov_experience: 30,
  pilot_evidence: 25,
  field_deployment: 15,
  financial_depth: 12,
  delivery_capacity: 8,
  institutional_backing: 5,
  jurisdictions: 5,
  infrastructure_fit: 5,
  ready_at: 65,
  approaching_at: 40,
  min_signals_for_ready: 3,
};

export interface PppInput {
  gov_experience: boolean | null;
  poc_status: "none" | "pilot_completed" | "deployed_in_field" | null;
  infra_intensity: "plug_and_play" | "moderate" | "heavy" | null;
  funding_raised_usd: number | null;
  team_size: number | null;
  /** true = a verified affiliation exists, false = confirmed none, null = unknown. */
  backing: boolean | null;
  countries_active: string[];
  /**
   * Outcome of this company's own completed pilots in this system.
   * "met" if any met its objectives, "partial", "not_met", or null when
   * they have never run one with us.
   */
  pilot_outcome: "met_objectives" | "partial" | "not_met" | null;
}

export function computePppReadiness(
  input: PppInput,
  w: PppWeights = DEFAULT_PPP_WEIGHTS
): PppResult {
  const signals: PppSignal[] = [];
  const add = (
    key: PppSignalKey,
    label: string,
    known: boolean,
    fraction: number,
    max: number,
    note: string
  ) => signals.push({ key, label, known, earned: known ? fraction * max : 0, max, note });

  // 1. Government experience — known only as an explicit boolean.
  add(
    "gov_experience",
    "Public-sector experience",
    input.gov_experience !== null,
    input.gov_experience === true ? 1 : 0,
    w.gov_experience,
    input.gov_experience === null
      ? "Not recorded"
      : input.gov_experience
        ? "Has delivered for a public body"
        : "No public-sector delivery on record"
  );

  // 2. Our own pilot. Unknown unless they have actually run one here —
  //    never having piloted with us is not evidence against them.
  add(
    "pilot_evidence",
    "Pilot with us",
    input.pilot_outcome !== null,
    input.pilot_outcome === "met_objectives"
      ? 1
      : input.pilot_outcome === "partial"
        ? 0.5
        : 0,
    w.pilot_evidence,
    input.pilot_outcome === null
      ? "No completed pilot with us yet"
      : input.pilot_outcome === "met_objectives"
        ? "Completed a pilot and met its objectives"
        : input.pilot_outcome === "partial"
          ? "Completed a pilot, partially met"
          : "Completed a pilot that did not meet its objectives"
  );

  // 3. Field deployment.
  add(
    "field_deployment",
    "Deployment track record",
    input.poc_status !== null,
    input.poc_status === "deployed_in_field"
      ? 1
      : input.poc_status === "pilot_completed"
        ? 0.5
        : 0,
    w.field_deployment,
    input.poc_status === null
      ? "Not recorded"
      : input.poc_status === "deployed_in_field"
        ? "Running in the field"
        : input.poc_status === "pilot_completed"
          ? "Pilot completed, not yet deployed"
          : "No proof of concept on record"
  );

  // 4. Financial depth.
  const f = input.funding_raised_usd;
  add(
    "financial_depth",
    "Financial depth",
    f !== null,
    f === null ? 0 : f > 5_000_000 ? 1 : f >= 1_000_000 ? 0.6 : f > 0 ? 0.25 : 0,
    w.financial_depth,
    f === null
      ? "Funding not recorded"
      : f === 0
        ? "Bootstrapped — thin for procurement payment cycles"
        : `Raised ${usdShort(f)}`
  );

  // 5. Delivery capacity.
  const t = input.team_size;
  add(
    "delivery_capacity",
    "Delivery capacity",
    t !== null,
    t === null ? 0 : t > 50 ? 1 : t > 20 ? 0.7 : t >= 6 ? 0.4 : 0.1,
    w.delivery_capacity,
    t === null ? "Team size not recorded" : `${t} people`
  );

  // 6. Institutional backing.
  add(
    "institutional_backing",
    "Institutional backing",
    input.backing !== null,
    input.backing === true ? 1 : 0,
    w.institutional_backing,
    input.backing === null
      ? "Not recorded"
      : input.backing
        ? "Verified institutional affiliation"
        : "No affiliations, confirmed"
  );

  // 7. Jurisdictions cleared. Zero recorded countries is unknown, not a
  //    confirmed zero — nobody states "operates nowhere".
  const n = input.countries_active.length;
  add(
    "jurisdictions",
    "Jurisdictions operated in",
    n > 0,
    n >= 3 ? 1 : n === 2 ? 0.6 : 0.25,
    w.jurisdictions,
    n === 0 ? "No countries recorded" : `Active in ${n} ${n === 1 ? "country" : "countries"}`
  );

  // 8. Infrastructure fit — the inversion. Heavy infra is a PPP's
  //    natural domain, and the thing a short pilot cannot absorb.
  add(
    "infrastructure_fit",
    "Infrastructure profile",
    input.infra_intensity !== null,
    input.infra_intensity === "heavy"
      ? 1
      : input.infra_intensity === "moderate"
        ? 0.6
        : 0.3,
    w.infrastructure_fit,
    input.infra_intensity === null
      ? "Not recorded"
      : input.infra_intensity === "heavy"
        ? "Heavy infrastructure — squarely PPP territory"
        : input.infra_intensity === "moderate"
          ? "Moderate infrastructure need"
          : "Plug and play — may not need a partnership structure"
  );

  const known = signals.filter((s) => s.known);
  const denominator = known.reduce((a, s) => a + s.max, 0);
  const earned = known.reduce((a, s) => a + s.earned, 0);
  const score =
    denominator > 0 ? Math.round((100 * earned) / denominator) : null;

  return {
    score,
    band: bandOf(score, known.length, w),
    signals,
    knownCount: known.length,
    thinEvidence: score !== null && known.length < w.min_signals_for_ready,
  };
}

/**
 * Ratio decides the band; breadth decides whether the top band is on
 * offer at all. A company scoring 100 on one known signal is capped at
 * "approaching" — the number is real, the claim is not yet earned.
 */
export function bandOf(
  score: number | null,
  knownCount: number,
  w: PppWeights = DEFAULT_PPP_WEIGHTS
): PppBand {
  if (score === null) return "unassessed";
  if (score >= w.ready_at) {
    return knownCount >= w.min_signals_for_ready ? "ready" : "approaching";
  }
  if (score >= w.approaching_at) return "approaching";
  return "pilot_first";
}

export const PPP_BANDS: { key: PppBand; label: string; blurb: string }[] = [
  {
    key: "ready",
    label: "PPP ready",
    blurb: "Evidence supports taking this to a partnership structure.",
  },
  {
    key: "approaching",
    label: "Approaching",
    blurb: "Some of the case is there; the gaps are named per signal.",
  },
  {
    key: "pilot_first",
    label: "Pilot first",
    blurb: "Not yet a PPP case — prove it at pilot scale.",
  },
  {
    key: "unassessed",
    label: "Not assessable",
    blurb: "Nothing known yet. Analyse them and this fills in.",
  },
];

function usdShort(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${n}`;
}

/** Tolerant merge of a config row over the defaults. */
export function pppWeightsFrom(raw: unknown): PppWeights {
  if (!raw || typeof raw !== "object") return DEFAULT_PPP_WEIGHTS;
  const out = { ...DEFAULT_PPP_WEIGHTS };
  for (const k of Object.keys(DEFAULT_PPP_WEIGHTS) as (keyof PppWeights)[]) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[k] = v;
  }
  return out;
}
