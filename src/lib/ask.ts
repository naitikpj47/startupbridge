import { anthropicClient, anthropicModel, firstText } from "@/lib/ai/claude";

/**
 * Turn a program officer's plain sentence — "I need something that helps
 * decrease malaria in Thailand" — into a structured problem statement.
 * Everything downstream (brief, embedding, matching, sourcing) runs off
 * this, so the officer never fills a form unless they want to.
 */

const ASK_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "A precise problem-statement title, under 90 chars, in the register of a program document — not a question" },
    country: { type: ["string", "null"], description: "ISO 3166-1 alpha-2 code if a country is named or clearly implied, else null" },
    sector: { type: ["string", "null"], description: "One lowercase sector: health, agriculture, climate, water, urban, energy, logistics, education" },
    sdg_tags: { type: "array", items: { type: "string" }, description: "Relevant SDG codes like SDG3, SDG13 — at most 3" },
    description: { type: "string", description: "3-5 sentences expanding the ask into a problem statement: who is affected, why it persists, what constraints a solution faces. Never invent statistics." },
  },
  required: ["title", "country", "sector", "sdg_tags", "description"],
  additionalProperties: false,
} as const;

export interface StructuredAsk {
  title: string;
  country: string | null;
  sector: string | null;
  sdg_tags: string[];
  description: string;
}

export async function structureAsk(ask: string): Promise<StructuredAsk> {
  const message = await anthropicClient().messages.create({
    model: anthropicModel(),
    max_tokens: 1200,
    output_config: { format: { type: "json_schema", schema: ASK_SCHEMA } },
    system:
      "You convert a program officer's informal request into a structured " +
      "public-sector problem statement. Stay strictly within what they asked " +
      "for — do not broaden the geography or invent numbers. Refer to " +
      "institutions generically (e.g. 'provincial health authorities'); never " +
      "name a specific real organization.",
    messages: [{ role: "user", content: `The officer wrote: "${ask}"` }],
  });
  return JSON.parse(firstText(message)) as StructuredAsk;
}
