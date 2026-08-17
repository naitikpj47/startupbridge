/**
 * Pilot terms and the PPP pathway — the pure half.
 *
 * Shapes, sanitizers and the stage list live here so the server actions,
 * the client panel and the tests all agree on one definition, and none
 * of it drags an SDK anywhere.
 *
 * Doctrine note: everything in a pilot is officer-authored. The only
 * seeding ever done is verbatim text from the officer's own confirmed
 * intake answers — a pilot agreement is exactly the kind of document
 * that gets forwarded, so nothing in it may originate from a model.
 */

export interface PilotObjective {
  /** What the pilot sets out to do — the officer's words. */
  text: string;
  /** How we'd know — a measure or condition. Optional. */
  measure: string;
}

export interface PilotMilestone {
  month: number;
  deliverable: string;
}

export interface PathwayStage {
  key: string;
  done: boolean;
  note: string;
}

export const PILOT_STATUSES = [
  "drafted",
  "agreed",
  "underway",
  "completed",
  "cancelled",
] as const;
export type PilotStatus = (typeof PILOT_STATUSES)[number];

export const PILOT_OUTCOMES = [
  { key: "met_objectives", label: "Met its objectives" },
  { key: "partial", label: "Partially met" },
  { key: "not_met", label: "Did not meet them" },
] as const;

export const SCALE_DECISIONS = [
  { key: "recommend_ppp", label: "Recommend for PPP scale-up" },
  { key: "extend_pilot", label: "Extend the pilot" },
  { key: "close_out", label: "Close out" },
] as const;

/**
 * The pathway from a successful pilot to a commercial-scale
 * public-private partnership. Generic by design — institutions are
 * never named; each stage is a checkpoint the officer works through and
 * annotates in their own words.
 */
export const PPP_STAGES = [
  {
    key: "evaluation",
    title: "Evaluate against objectives",
    blurb:
      "Document results against each pilot objective, with the evidence that would satisfy an external reviewer.",
  },
  {
    key: "counterpart",
    title: "Government counterpart and mandate",
    blurb:
      "Secure the implementing agency's commitment to scale, and the mandate or policy hook the project will sit under.",
  },
  {
    key: "model",
    title: "PPP model and procurement route",
    blurb:
      "Choose the partnership structure and the procurement route it must clear, with the startup's role defined.",
  },
  {
    key: "finance",
    title: "Financing and risk allocation",
    blurb:
      "Structure the capital — public, private, blended — and write down who carries which risk.",
  },
  {
    key: "close",
    title: "Procurement to commercial close",
    blurb:
      "Run the procurement, negotiate the agreement, and hand over to the delivery structure.",
  },
] as const;

export const BUDGET_DEFAULT_USD = 500_000;
export const DURATION_DEFAULT_MONTHS = 12;
export const DURATION_MAX_MONTHS = 60;
const OBJECTIVES_MAX = 8;
const MILESTONES_MAX = 12;

/** Trim, drop empties, cap counts and lengths. Never throws. */
export function cleanObjectives(input: unknown): PilotObjective[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((o) => ({
      text: String((o as PilotObjective)?.text ?? "").trim().slice(0, 300),
      measure: String((o as PilotObjective)?.measure ?? "").trim().slice(0, 200),
    }))
    .filter((o) => o.text.length > 0)
    .slice(0, OBJECTIVES_MAX);
}

/** Valid months only (1..duration), sorted, capped. Never throws. */
export function cleanMilestones(
  input: unknown,
  durationMonths: number
): PilotMilestone[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((m) => ({
      month: Math.round(Number((m as PilotMilestone)?.month)),
      deliverable: String((m as PilotMilestone)?.deliverable ?? "")
        .trim()
        .slice(0, 300),
    }))
    .filter(
      (m) =>
        Number.isFinite(m.month) &&
        m.month >= 1 &&
        m.month <= durationMonths &&
        m.deliverable.length > 0
    )
    .sort((a, b) => a.month - b.month)
    .slice(0, MILESTONES_MAX);
}

/** Budget: positive, finite, capped at $100M, rounded to the dollar. */
export function cleanBudget(input: unknown): number | null {
  const n = Number(input);
  if (!Number.isFinite(n) || n <= 0 || n > 100_000_000) return null;
  return Math.round(n);
}

export function cleanDuration(input: unknown): number | null {
  const n = Math.round(Number(input));
  if (!Number.isFinite(n) || n < 1 || n > DURATION_MAX_MONTHS) return null;
  return n;
}

/**
 * Merge one stage update into a stored pathway, returning the canonical
 * shape: every known stage, in PPP_STAGES order, unknown keys dropped.
 */
export function pathwayWithStage(
  existing: unknown,
  key: string,
  done: boolean,
  note: string
): { stages: PathwayStage[] } {
  const prior = new Map<string, PathwayStage>();
  const stored = (existing as { stages?: PathwayStage[] })?.stages;
  if (Array.isArray(stored)) {
    for (const s of stored) {
      if (s && typeof s.key === "string") {
        prior.set(s.key, {
          key: s.key,
          done: Boolean(s.done),
          note: String(s.note ?? "").slice(0, 2000),
        });
      }
    }
  }
  const stages = PPP_STAGES.map((def) => {
    const current = prior.get(def.key) ?? { key: def.key, done: false, note: "" };
    return def.key === key
      ? { key: def.key, done, note: note.trim().slice(0, 2000) }
      : current;
  });
  return { stages };
}

/**
 * Seed objectives from the officer's own confirmed intake answers —
 * verbatim, labelled as theirs, freely editable. Returns [] when the
 * problem predates the structured intake.
 */
export function seedObjectives(
  intakeAnswers: unknown
): PilotObjective[] {
  if (!Array.isArray(intakeAnswers)) return [];
  const byKey = new Map(
    (intakeAnswers as { key?: string; value?: string; unknown?: boolean }[])
      .filter((a) => a && typeof a.key === "string")
      .map((a) => [a.key as string, a])
  );
  const seeds: PilotObjective[] = [];
  const success = byKey.get("success");
  if (success && !success.unknown && success.value?.trim()) {
    seeds.push({ text: success.value.trim().slice(0, 300), measure: "" });
  }
  return seeds;
}
