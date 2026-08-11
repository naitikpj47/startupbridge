import { anthropicClient, anthropicModel, firstText } from "@/lib/ai/claude";
import { countryName } from "@/lib/countries";

export interface ProblemForEnrichment {
  title: string;
  country: string | null;
  sector: string | null;
  description: string | null;
}

/**
 * Expand a problem statement into an enriched brief: context, affected
 * population, constraints, and what a good solution looks like. A program
 * officer must confirm the brief before the problem opens for matching.
 */
export async function generateEnrichedBrief(
  problem: ProblemForEnrichment
): Promise<string> {
  const message = await anthropicClient().messages.create({
    model: anthropicModel(),
    max_tokens: 1500,
    system:
      "You write concise briefing documents for program officers evaluating " +
      "public-sector problem statements in developing regions. Write in plain, " +
      "specific prose. Never invent statistics; where a number would help, " +
      "describe the magnitude qualitatively instead. Refer to institutions " +
      "generically (e.g. 'the national health ministry', 'provincial " +
      "authorities') — never name specific organizations.",
    messages: [
      {
        role: "user",
        content:
          `Expand this problem statement into an enriched brief with four short sections:\n` +
          `1. Context — the situation on the ground and why it persists\n` +
          `2. Affected population — who bears the cost, and how\n` +
          `3. Constraints — infrastructure, budget, capacity, and political realities a solution must respect\n` +
          `4. What a good solution looks like — concrete properties, not vendor language\n\n` +
          `Title: ${problem.title}\n` +
          `Country: ${problem.country ? countryName(problem.country) : "unspecified"}\n` +
          `Sector: ${problem.sector ?? "unspecified"}\n` +
          `Description: ${problem.description ?? ""}\n\n` +
          `Use the section headings exactly as numbered above. Keep the whole brief under 400 words.`,
      },
    ],
  });
  return firstText(message).trim();
}
