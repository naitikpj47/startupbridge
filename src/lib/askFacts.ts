import { anthropicClient, firstText } from "@/lib/ai/claude";

/**
 * Context cards shown while the Ask pipeline runs — the loading screen
 * earns its time instead of spinning.
 *
 * Deliberately built on a small, fast model and fired in PARALLEL with
 * the real work, so it never delays the answer: it lands in ~2s while
 * structuring, briefing, embedding and matching take ~20s.
 *
 * These are read by program officers, so the prompt bans invented
 * numbers outright. Qualitative context an expert would recognise is
 * useful; a fabricated statistic in a government-facing tool is not.
 */

const FACTS_SCHEMA = {
  type: "object",
  properties: {
    facts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string", description: "2-4 word category, e.g. 'Why it persists'" },
          text: { type: "string", description: "One sentence, under 160 chars" },
        },
        required: ["label", "text"],
        additionalProperties: false,
      },
    },
  },
  required: ["facts"],
  additionalProperties: false,
} as const;

export interface AskFact {
  label: string;
  text: string;
}

export async function generateAskFacts(ask: string): Promise<AskFact[]> {
  const message = await anthropicClient().messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 600,
    output_config: { format: { type: "json_schema", schema: FACTS_SCHEMA } },
    system:
      "You give a program officer useful context on a development problem " +
      "while a search runs. Write like a well-briefed colleague, not a " +
      "textbook.\n\n" +
      "HARD RULE: never state a statistic, percentage, count, year, or " +
      "monetary figure. You cannot verify them and a wrong number in a " +
      "government-facing tool is worse than no number. Describe magnitude " +
      "in words instead ('most', 'a persistent minority', 'seasonally').\n\n" +
      "Prefer the non-obvious: why the problem resists easy fixes, what " +
      "usually fails in the field, what a solution has to survive. Refer to " +
      "institutions generically — never name a real organization.",
    messages: [
      {
        role: "user",
        content:
          `A program officer just asked for help with: "${ask}"\n\n` +
          `Give 4 short context cards. Suggested angles: the mechanism behind ` +
          `the problem, who bears the cost, what typically defeats solutions ` +
          `in the field, and what "working" looks like on the ground.`,
      },
    ],
  });
  const { facts } = JSON.parse(firstText(message)) as { facts: AskFact[] };
  return facts.slice(0, 4);
}
