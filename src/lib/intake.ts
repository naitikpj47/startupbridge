import { anthropicClient, anthropicModel, firstText } from "@/lib/ai/claude";
import {
  DIMENSIONS,
  LABEL,
  type DimensionKey,
  type DraftedProblem,
  type IntakeAnswer,
  type IntakeQuestion,
  type IntakeRead,
} from "@/lib/intake-shared";

export * from "@/lib/intake-shared";

/**
 * Structured intake with a sufficiency gate.
 *
 * The old one-shot path took "help with malaria in Thailand" and had a
 * model write five confident sentences about drug resistance, migrant
 * workers and border provinces. None of it came from the officer. In a
 * government-facing tool that is not a rough draft, it is fabrication —
 * and everything downstream (embedding, matching, briefings) inherits it.
 *
 * The rule here, enforced in three places:
 *
 *   1. READ  — the model may only mark a dimension "captured" if the
 *              officer's own words support it, and must quote them.
 *   2. GATE  — deterministic, in code. The model advises; it never
 *              decides whether there is enough to draft.
 *   3. DRAFT — receives ONLY confirmed answers. Gaps are printed as open
 *              questions, never smoothed over.
 *
 * Suggestions still make it feel like a conversation rather than a form:
 * the model proposes concrete options, but a suggestion is an OFFER. It
 * enters the record only when the officer clicks it.
 */

const READ_SCHEMA = {
  type: "object",
  properties: {
    understood: {
      type: "string",
      description:
        "One sentence, second person, restating ONLY what they actually said. " +
        "No added specifics. Example: 'You're looking for something that " +
        "reduces malaria cases in Thailand.'",
    },
    dimensions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: {
            type: "string",
            enum: ["problem", "where", "who", "today", "constraints", "success"],
          },
          captured: {
            type: ["string", "null"],
            description:
              "If and only if their words directly establish this, a short " +
              "restatement of what they said. Otherwise null. Inference is " +
              "not capture: 'malaria in Thailand' establishes where, and " +
              "the topic, but says nothing about who is affected, what has " +
              "been tried, constraints, or success.",
          },
          quote: {
            type: ["string", "null"],
            description:
              "The exact substring of their message that justifies `captured`. " +
              "Null when captured is null. If you cannot quote them, it is not captured.",
          },
          question: {
            type: "string",
            description:
              "A warm, specific question a knowledgeable colleague would ask — " +
              "second person, under 90 characters, no jargon. Ask even when " +
              "captured, phrased as a refinement.",
          },
          why: {
            type: "string",
            description:
              "Under 70 characters: what this changes about the search. " +
              "Concrete, e.g. 'Changes whether offline-first is a hard requirement.'",
          },
          options: {
            type: "array",
            items: { type: "string", description: "Under 60 characters" },
            description:
              "4-5 plausible, mutually distinct answers, phrased as things " +
              "the officer might say. Specific enough to be worth clicking " +
              "('Health posts with no reliable mains power'), never so " +
              "specific they assert unverifiable fact. No statistics.",
          },
        },
        required: ["key", "captured", "quote", "question", "why", "options"],
        additionalProperties: false,
      },
    },
  },
  required: ["understood", "dimensions"],
  additionalProperties: false,
} as const;

const READ_SYSTEM =
  "You are helping a public-sector program officer turn a rough need into " +
  "a problem statement that a startup could actually respond to. You are " +
  "the colleague who asks the good questions — not a form.\n\n" +
  "THE ONE RULE: you do not know anything about their situation that they " +
  "have not told you. Their message is the only evidence that exists. " +
  "Marking a dimension `captured` when they did not actually say it is the " +
  "worst thing you can do here, because it puts words in a government " +
  "officer's mouth and everything downstream treats it as their intent.\n\n" +
  "Test before capturing: can you quote the substring of their message " +
  "that establishes it? If not, it is missing. Naming a disease and a " +
  "country captures the problem and the location — nothing else.\n\n" +
  "Your options are OFFERS, not guesses at the truth. Make them concrete " +
  "and field-realistic so clicking one is faster than typing, and make " +
  "them genuinely different from each other so the choice carries " +
  "information. Never put a statistic, percentage, year or currency " +
  "figure in an option. Never name a real organization — say 'district " +
  "health office', 'the implementing partner', 'program officers'.";

/** One call: understand what they said, ask about what they didn't. */
export async function readAsk(ask: string): Promise<IntakeRead> {
  const message = await anthropicClient().messages.create({
    model: anthropicModel(),
    max_tokens: 2000,
    output_config: { format: { type: "json_schema", schema: READ_SCHEMA } },
    system: READ_SYSTEM,
    messages: [
      {
        role: "user",
        content:
          `A program officer wrote:\n\n"${ask}"\n\n` +
          `Return all six dimensions in this order: problem, where, who, ` +
          `today, constraints, success.`,
      },
    ],
  });

  const raw = JSON.parse(firstText(message)) as {
    understood: string;
    dimensions: {
      key: DimensionKey;
      captured: string | null;
      quote: string | null;
      question: string;
      why: string;
      options: string[];
    }[];
  };

  const byKey = new Map(raw.dimensions.map((d) => [d.key, d]));

  const questions: IntakeQuestion[] = DIMENSIONS.map(({ key }) => {
    const d = byKey.get(key);
    // Belt and braces on rule 1: a capture without a quote that actually
    // appears in the officer's message is downgraded to missing. The
    // model can claim; only their words can confirm.
    const quoted =
      d?.quote && ask.toLowerCase().includes(d.quote.toLowerCase().trim())
        ? d.quote
        : null;
    return {
      key,
      question: d?.question ?? `Anything to add about ${key}?`,
      why: d?.why ?? "",
      options: (d?.options ?? []).slice(0, 5),
      captured: quoted ? (d?.captured ?? null) : null,
      quote: quoted,
    };
  });

  return { understood: raw.understood, questions };
}

const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description:
        "Under 90 characters, in the register of a program document, not a " +
        "question. Built only from confirmed facts.",
    },
    country: {
      type: ["string", "null"],
      description:
        "ISO 3166-1 alpha-2 code ONLY if the officer named a country. Null otherwise.",
    },
    sector: {
      type: ["string", "null"],
      description:
        "One of: health, agriculture, climate, water, urban, energy, " +
        "logistics, education. Null if not clear from what they confirmed.",
    },
    sdg_tags: {
      type: "array",
      items: { type: "string" },
      description: "At most 3 SDG codes like SDG3. Only ones clearly implied.",
    },
    description: {
      type: "string",
      description:
        "4-6 sentences in the register of a program document. Every sentence " +
        "must trace to a confirmed fact. Write ABOUT THE PROBLEM, never about " +
        "the conversation: no 'the officer confirmed', 'as stated', 'was " +
        "specifically named'. Close with one neutral sentence naming what is " +
        "not yet established ('The current approach and success criteria are " +
        "not yet defined.'). Never invent numbers, causes, institutions or " +
        "affected groups.",
    },
    open_questions: {
      type: "array",
      items: { type: "string", description: "Under 100 characters" },
      description:
        "One line per unconfirmed dimension, phrased as the question still " +
        "outstanding. Empty array if nothing is missing.",
    },
  },
  required: ["title", "country", "sector", "sdg_tags", "description", "open_questions"],
  additionalProperties: false,
} as const;

/**
 * Draft from confirmed facts only.
 *
 * The prompt is written defensively because this is the last point where
 * invention could enter the record: the model is told, in effect, that an
 * incomplete honest brief beats a complete invented one.
 */
export async function draftProblem(
  ask: string,
  answers: IntakeAnswer[]
): Promise<DraftedProblem> {
  const confirmed = answers.filter((a) => !a.unknown && a.value.trim());
  const unknown = answers.filter((a) => a.unknown);

  const facts = confirmed
    .map((a) => `- ${LABEL[a.key]}: ${a.value.trim()}`)
    .join("\n");
  const gaps = [
    ...unknown.map((a) => LABEL[a.key]),
    ...DIMENSIONS.map((d) => d.key).filter(
      (k) => !answers.some((a) => a.key === k)
    ).map((k) => LABEL[k]),
  ];

  const message = await anthropicClient().messages.create({
    model: anthropicModel(),
    max_tokens: 1400,
    output_config: { format: { type: "json_schema", schema: DRAFT_SCHEMA } },
    system:
      "You write public-sector problem statements from confirmed facts.\n\n" +
      "You are working from a record of what a program officer explicitly " +
      "said and confirmed. That record is the complete extent of what is " +
      "known. You have no other information about this situation, and you " +
      "must not supply any — not context you believe is standard for the " +
      "region, not typical causes, not likely affected groups, not " +
      "plausible constraints, and above all not numbers.\n\n" +
      "An incomplete statement that is entirely true is useful. A complete " +
      "statement containing one invented detail is worse than nothing, " +
      "because a program officer will send it onward believing it is theirs.\n\n" +
      "Where something is unknown, say so plainly in the description or " +
      "leave it out — do not paper over it with generalities. Refer to " +
      "institutions generically; never name a real organization.\n\n" +
      "Write it as the officer would send it onward: a statement about the " +
      "problem, not a report on how you gathered it. The reader should never " +
      "see the seams of this process.",
    messages: [
      {
        role: "user",
        content:
          `The officer's original words:\n"${ask}"\n\n` +
          `Confirmed in conversation:\n${facts || "- (nothing beyond the original words)"}\n\n` +
          (gaps.length
            ? `Explicitly NOT known — the officer was asked and could not say. ` +
              `Do not fill these in:\n${gaps.map((g) => `- ${g}`).join("\n")}\n\n`
            : "Nothing is missing.\n\n") +
          `Write the problem statement.`,
      },
    ],
  });

  const draft = JSON.parse(firstText(message)) as DraftedProblem;
  return {
    ...draft,
    country:
      draft.country && /^[A-Z]{2}$/i.test(draft.country)
        ? draft.country.toUpperCase()
        : null,
    sector: draft.sector?.toLowerCase() ?? null,
    sdg_tags: (draft.sdg_tags ?? []).slice(0, 3),
    open_questions: (draft.open_questions ?? []).slice(0, 6),
  };
}
