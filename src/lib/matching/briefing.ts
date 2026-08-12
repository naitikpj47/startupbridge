import type { SupabaseClient } from "@supabase/supabase-js";
import { anthropicClient, anthropicModel, firstText } from "@/lib/ai/claude";
import { countryName } from "@/lib/countries";

/**
 * Rationale (2-3 sentences) and one-page briefing note, generated when a
 * match is shortlisted — stored on the match, never regenerated per
 * view. briefing_generated_at stamps the generation so the dashboard can
 * offer "regenerate" when the profile changed after that stamp.
 */
export async function generateMatchBriefing(
  sb: SupabaseClient,
  matchId: string
): Promise<void> {
  const { data, error } = await sb
    .from("matches")
    .select(
      "id, similarity, context_fit, strategic_fit, final_score, " +
        "problems(title, country, sector, description, enriched_brief), " +
        "startups(name, tagline, description, review_flags, " +
        "startup_profiles(profile_text, base_readiness, data_confidence, poc_status, poc_evidence, infra_intensity, countries_active, hq_country, team_size))"
    )
    .eq("id", matchId)
    .single();
  if (error || !data) throw new Error(`loading match ${matchId}: ${error?.message}`);
  // The concatenated select string defeats supabase-js's literal-type
  // parser, so shape the row explicitly.
  const match = data as unknown as {
    similarity: number;
    context_fit: number | null;
    strategic_fit: number;
    final_score: number;
    problems: Record<string, string | null> | Record<string, string | null>[];
    startups:
      | { name: string; review_flags: unknown; startup_profiles: unknown }
      | { name: string; review_flags: unknown; startup_profiles: unknown }[];
  };

  const problem = Array.isArray(match.problems) ? match.problems[0] : match.problems;
  const startup = Array.isArray(match.startups) ? match.startups[0] : match.startups;
  const profile = Array.isArray(startup.startup_profiles)
    ? startup.startup_profiles[0]
    : startup.startup_profiles;

  const verifyFlags = ((startup.review_flags ?? []) as { type: string; detail: string }[])
    .filter((f) => f.type === "verify_before_intro")
    .map((f) => f.detail);

  const facts =
    `PROBLEM\nTitle: ${problem.title}\nCountry: ${problem.country ? countryName(problem.country) : "unspecified"}\n` +
    `Sector: ${problem.sector ?? "unspecified"}\nDescription: ${problem.description ?? ""}\n` +
    `Brief:\n${problem.enriched_brief ?? "(none)"}\n\n` +
    `STARTUP\n${profile.profile_text ?? startup.name}\n` +
    `PoC status: ${profile.poc_status ?? "unknown"}\nPoC evidence: ${profile.poc_evidence ?? "none recorded"}\n` +
    `Infrastructure intensity: ${profile.infra_intensity ?? "unknown"}\n` +
    `Team size: ${profile.team_size ?? "unknown"}\nHQ: ${profile.hq_country ? countryName(profile.hq_country) : "unknown"}\n` +
    `Base readiness: ${profile.base_readiness ?? "not scored"} (confidence: ${profile.data_confidence ?? "unknown"})\n\n` +
    `SCORES\nSimilarity: ${(match.similarity * 100).toFixed(0)}\nContext fit: ${match.context_fit ?? "unknown"}\n` +
    `Partnership priority: ${match.strategic_fit}\nFinal: ${match.final_score}\n\n` +
    `VERIFY BEFORE INTRO\n${verifyFlags.length ? verifyFlags.map((f) => `- ${f}`).join("\n") : "(none)"}`;

  const system =
    "You write internal briefing material for program officers weighing an " +
    "introduction between a startup and a public-sector problem owner. Be " +
    "factual and grounded ONLY in the material provided — never invent " +
    "numbers, partners, or capabilities. Refer to institutions generically; " +
    "never name a specific real organization. State weaknesses and open " +
    "questions as plainly as strengths.";

  const client = anthropicClient();
  const model = anthropicModel();

  const [rationaleMsg, briefingMsg] = await Promise.all([
    client.messages.create({
      model,
      max_tokens: 300,
      system,
      messages: [
        {
          role: "user",
          content: `${facts}\n\nWrite a 2-3 sentence rationale for why this startup is (or is not yet) a strong fit for this problem. Plain prose, no headings.`,
        },
      ],
    }),
    client.messages.create({
      model,
      max_tokens: 1800,
      system,
      messages: [
        {
          role: "user",
          content:
            `${facts}\n\nWrite a one-page briefing note in Markdown with sections:\n` +
            `## The problem (2-3 sentences)\n## The startup (2-3 sentences)\n` +
            `## Evidence of deployability (what is actually proven, citing the PoC evidence)\n` +
            `## Fit analysis (geography, sector, readiness — including what does NOT fit)\n` +
            `## Verify before introduction (the open questions; use the flags provided)\n` +
            `## Suggested next step (one concrete action for the program officer)\n` +
            `Keep it under 450 words. No preamble before the first heading.`,
        },
      ],
    }),
  ]);

  const { error: uErr } = await sb
    .from("matches")
    .update({
      rationale: firstText(rationaleMsg).trim(),
      briefing_note: firstText(briefingMsg).trim(),
      briefing_generated_at: new Date().toISOString(),
    })
    .eq("id", matchId);
  if (uErr) throw new Error(`storing briefing for ${matchId}: ${uErr.message}`);
}
