/**
 * The parts of the intake both sides need: the dimensions, the shapes,
 * and the sufficiency gate itself.
 *
 * Split out from `intake.ts` so the browser can render the rail and run
 * the same gate for live feedback without pulling the Anthropic SDK into
 * the bundle. The server runs this gate again before drafting — the
 * client copy is for the progress bar, not for permission.
 */

/** The six things you need before you can describe a problem honestly. */
export const DIMENSIONS = [
  {
    key: "problem",
    label: "The problem",
    icon: "target",
    blurb: "What is actually going wrong",
  },
  {
    key: "where",
    label: "Where",
    icon: "pin",
    blurb: "Country, region, the kind of place",
  },
  {
    key: "who",
    label: "Who it hits",
    icon: "people",
    blurb: "Who bears the cost today",
  },
  {
    key: "today",
    label: "What's tried",
    icon: "cycle",
    blurb: "Current approach and where it breaks",
  },
  {
    key: "constraints",
    label: "Constraints",
    icon: "shield",
    blurb: "What a solution has to survive",
  },
  {
    key: "success",
    label: "What good looks like",
    icon: "flag",
    blurb: "How you'd know it worked",
  },
] as const;

export type DimensionKey = (typeof DIMENSIONS)[number]["key"];

export const LABEL: Record<DimensionKey, string> = Object.fromEntries(
  DIMENSIONS.map((d) => [d.key, d.label.toLowerCase()])
) as Record<DimensionKey, string>;

export interface IntakeQuestion {
  key: DimensionKey;
  /** Conversational, second person, no jargon. */
  question: string;
  /** Why it changes the answer — one short line, shown under the question. */
  why: string;
  /** Clickable offers. Never treated as facts until chosen. */
  options: string[];
  /** Present only when the officer's own words already covered this. */
  captured: string | null;
  /** The officer's words that justified `captured`. Empty when missing. */
  quote: string | null;
}

export interface IntakeRead {
  /** Echoed back so the officer can see they were understood, not parsed. */
  understood: string;
  questions: IntakeQuestion[];
}

/** What the officer confirmed for one dimension. */
export interface IntakeAnswer {
  key: DimensionKey;
  /** Chosen chips plus anything typed. Empty means skipped. */
  value: string;
  /** True when they explicitly said they don't know — an honest gap. */
  unknown: boolean;
}

export interface DraftedProblem {
  title: string;
  country: string | null;
  sector: string | null;
  sdg_tags: string[];
  description: string;
  /** Gaps, verbatim in the record. Shown to the officer and stored. */
  open_questions: string[];
}

export interface Sufficiency {
  ok: boolean;
  confirmed: DimensionKey[];
  /** Named gaps, in the order they should be pressed on. */
  missing: DimensionKey[];
  /** Blocking gaps — the draft cannot be honest without these. */
  blocking: DimensionKey[];
  /** Plain-language line for the UI. */
  message: string;
}

/**
 * Sufficiency, decided in code.
 *
 * You cannot write a problem statement without knowing what is wrong and
 * roughly where. Beyond that, one lived detail — who it hits, what has
 * been tried, what it has to survive, or what working looks like —
 * separates a real brief from a topic label.
 */
const REQUIRED: DimensionKey[] = ["problem", "where"];
const NEED_ONE_OF: DimensionKey[] = ["who", "today", "constraints", "success"];

/**
 * The gate. Deterministic on purpose: a model asked "is this enough?"
 * will say yes under mild pressure, and this is the one decision that
 * must not be negotiable.
 */
export function checkSufficiency(answers: IntakeAnswer[]): Sufficiency {
  const filled = new Set(
    answers
      .filter((a) => !a.unknown && a.value.trim().length >= 3)
      .map((a) => a.key)
  );
  const keys = DIMENSIONS.map((d) => d.key);
  const confirmed = keys.filter((k) => filled.has(k));
  const missing = keys.filter((k) => !filled.has(k));

  const blocking = REQUIRED.filter((k) => !filled.has(k));
  const hasDetail = NEED_ONE_OF.some((k) => filled.has(k));
  const topicOnly = blocking.length === 0 && !hasDetail;
  if (topicOnly) {
    // Nothing beyond topic and place: a label, not a problem statement.
    blocking.push(NEED_ONE_OF[0]);
  }

  let message: string;
  if (blocking.length === 0) {
    message =
      missing.length === 0
        ? "Everything's covered — this will be a precise brief."
        : `Enough to draft. ${missing.length} area${
            missing.length > 1 ? "s" : ""
          } will be written up as an open question rather than guessed at.`;
  } else if (topicOnly) {
    message =
      "That's a topic and a place, but not yet a problem. Add one lived " +
      "detail — who it hits, what's already been tried, or what would " +
      "count as working.";
  } else {
    message = `Still need ${blocking
      .map((k) => LABEL[k])
      .join(" and ")} before this can be drafted honestly.`;
  }

  return { ok: blocking.length === 0, confirmed, missing, blocking, message };
}
