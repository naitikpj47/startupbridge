import type { SupabaseClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { anthropicClient, anthropicModel, firstText } from "@/lib/ai/claude";
import { activeSearchProvider, searchWeb } from "@/lib/ai/websearch";
import { normalizeDomain } from "@/lib/domain";
import { countryName } from "@/lib/countries";

/**
 * Demand-driven sourcing (spec): when a problem yields nothing above the
 * threshold, hunt the live web for deployable candidates — problem terms
 * plus "pilot", "field-tested", "deployable", priority countries first,
 * university spinoff and TTO angles. Results NEVER go straight into
 * match results: they land in the review queue as source=scraped with
 * sourced_for set, and enrichment fills their profiles.
 *
 * Dedupe on domain; domains already in the pool are skipped, and
 * rejected domains are skipped SILENTLY (logged in the run summary
 * only). One automatic run per problem; re-triggers are manual.
 */

const CANDIDATE_SCHEMA = {
  type: "object",
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          website: { type: "string", description: "The company's own website URL" },
          evidence: { type: ["string", "null"], description: "Deployment/pilot evidence found, with source context" },
          hq_country: { type: ["string", "null"], description: "ISO alpha-2 if evidenced" },
        },
        required: ["name", "website", "evidence", "hq_country"],
        additionalProperties: false,
      },
    },
  },
  required: ["candidates"],
  additionalProperties: false,
} as const;

interface Candidate {
  name: string;
  website: string;
  evidence: string | null;
  hq_country: string | null;
}

const QUERY_SCHEMA = {
  type: "object",
  properties: {
    queries: {
      type: "array",
      items: { type: "string" },
      description: "4 web search queries, each targeting a different angle",
    },
  },
  required: ["queries"],
  additionalProperties: false,
} as const;

/**
 * FAST PATH — used whenever a search API key is configured.
 *
 * Three steps, ~10 seconds total:
 *   1. small model writes 4 search queries (different angles)
 *   2. all 4 queries fire in PARALLEL against the search API
 *   3. one model call reads the combined results and names candidates
 *
 * The built-in web_search tool does the same work sequentially, with
 * the model deliberating between searches — better judgement, but it
 * runs for many minutes. Officers watch this happen, so speed wins.
 */
async function researchViaSearchApi(
  problem: { title: string; country: string | null; sector: string | null; description: string | null },
  priorityCountries: string
): Promise<string> {
  const client = anthropicClient();
  const where = problem.country ? countryName(problem.country) : "developing regions";

  const queryMsg = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 500,
    output_config: { format: { type: "json_schema", schema: QUERY_SCHEMA } },
    messages: [
      {
        role: "user",
        content:
          `Write 4 web search queries to find STARTUPS with field-proven technology for this problem. ` +
          `Vary the angle: one plain product search, one with deployment evidence words ` +
          `("pilot" / "field-tested" / "deployed"), one geographic (${where} or ${priorityCountries || "Asia-Pacific"}), ` +
          `and one for university spinoffs / technology transfer.\n\n` +
          `Problem: ${problem.title}\nWhere: ${where}\nSector: ${problem.sector ?? ""}\n` +
          `${(problem.description ?? "").slice(0, 600)}\n\n` +
          `Return plain search-engine queries — no operators, no quotes around the whole query.`,
      },
    ],
  });
  const { queries } = JSON.parse(firstText(queryMsg)) as { queries: string[] };

  const hits = await searchWeb(queries.slice(0, 4));
  if (!hits.length) throw new Error("search returned no results");

  return hits
    .slice(0, 40)
    .map((h) => `${h.title}\n${h.url}\n${h.snippet}`)
    .join("\n\n");
}

export async function sourceCandidatesForProblem(
  sb: SupabaseClient,
  problemId: string
): Promise<void> {
  const { data: problemRow, error } = await sb
    .from("problems")
    .select("id, title, country, sector, description, enriched_brief")
    .eq("id", problemId)
    .single();
  if (error || !problemRow) throw new Error(`loading problem: ${error?.message}`);
  // Narrowed once here so the nested helpers see a non-null value.
  const problem = problemRow as {
    title: string;
    country: string | null;
    sector: string | null;
    description: string | null;
  };

  const { data: run, error: rErr } = await sb
    .from("sourcing_runs")
    .insert({ problem_id: problemId, status: "running" })
    .select("id")
    .single();
  if (rErr || !run) throw new Error(`creating sourcing run: ${rErr?.message}`);

  try {
    const { data: config } = await sb
      .from("scoring_config")
      .select("country_weights")
      .single();
    const priorityCountries = Object.keys(config?.country_weights ?? {})
      .filter((k) => k.toLowerCase() !== "default")
      .map((iso) => countryName(iso))
      .join(", ");

    const client = anthropicClient();
    const model = anthropicModel();

    // Fast path: with a search API key we run the loop ourselves and
    // finish in seconds. Without one, fall through to the built-in tool.
    const provider = activeSearchProvider();
    let researchText: string;
    if (provider) {
      console.log(`[sourcing ${problemId}] searching via ${provider}`);
      researchText = await researchViaSearchApi(problem, priorityCountries);
    } else {
      researchText = await researchViaBuiltInTool();
    }

    async function researchViaBuiltInTool(): Promise<string> {
    // Step 1 — search the live web. A long server-tool turn can come back
    // with stop_reason "pause_turn"; resume it by replaying the partial
    // assistant turn (bounded, so a stuck search can't loop forever).
    const searchMessages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content:
          `Find startups (not NGOs, not consultancies) whose technology could address this problem and that show real deployment or pilot evidence:\n\n` +
          `Problem: ${problem.title}\n` +
          `Where: ${problem.country ? countryName(problem.country) : "developing regions"}\n` +
          `Sector: ${problem.sector ?? ""}\n${problem.description ?? ""}\n\n` +
          `Prefer companies operating in or near: ${priorityCountries || "Asia-Pacific"}. ` +
          `Search with terms like "pilot", "field-tested", "deployable", and try university spinoff / TTO angles. ` +
          `List up to 8 companies with website URLs and evidence.`,
      },
    ];

    // Tuned for wall-clock, because an officer is watching a spinner:
    //  - 3 searches, not 5 (the 4th and 5th mostly re-find the same names)
    //  - effort "low": this step is retrieval, not deliberation, and high
    //    effort spends minutes reasoning between searches
    //  - at most ONE pause_turn resume, so a stuck search fails fast
    //    instead of tripling the runtime
    let research: Anthropic.Message | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      // Streamed: a multi-search turn outlives a normal HTTP request.
      const stream = client.messages.stream(
        {
          model,
          max_tokens: 3000,
          output_config: { effort: "low" },
          tools: [
            { type: "web_search_20260209", name: "web_search", max_uses: 3 } as Anthropic.Messages.ToolUnion,
          ],
          system:
            "You research startups with FIELD-PROVEN technology for development " +
            "problems. Deployability is everything: hunt for words like pilot, " +
            "field-tested, deployed, operational. Favor university spinoffs and " +
            "technology-transfer-office portfolios. Report each company with its " +
            "own website URL and the deployment evidence you found. Work quickly: " +
            "a few well-chosen searches, then report. Do not deliberate at length.",
          messages: searchMessages,
        },
        { timeout: 5 * 60_000 }
      );
      research = await stream.finalMessage();
      if (research.stop_reason !== "pause_turn") break;
      searchMessages.push({ role: "assistant", content: research.content });
    }
    if (!research) throw new Error("web search produced no response");

    const text = research.content
      .filter((b) => b.type === "text")
      .map((b) => (b as Anthropic.TextBlock).text)
      .join("\n");
    if (!text.trim()) throw new Error("web search returned no usable text");
    return text;
    }

    // Step 2 — structure the findings. Pure extraction from text we
    // already have, so the small model does it in a couple of seconds.
    const extraction = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 2000,
      output_config: {
        format: { type: "json_schema", schema: CANDIDATE_SCHEMA },
      },
      messages: [
        {
          role: "user",
          content:
            `From this research, extract the candidate companies. Only include real companies with their OWN website URL (no directories, news sites, or PDFs). Evidence should quote what was actually found.\n\n${researchText}`,
        },
      ],
    });
    const { candidates } = JSON.parse(firstText(extraction)) as {
      candidates: Candidate[];
    };

    // Existing + rejected domains — rejected are skipped silently.
    const { data: existingRows } = await sb
      .from("startups")
      .select("domain, status")
      .not("domain", "is", null);
    const existingDomains = new Map(
      (existingRows ?? []).map((r) => [r.domain as string, r.status as string])
    );

    let inserted = 0;
    let skippedExisting = 0;
    let skippedRejected = 0;

    for (const candidate of candidates.slice(0, 10)) {
      const domain = normalizeDomain(candidate.website);
      if (!domain) continue;
      const existingStatus = existingDomains.get(domain);
      if (existingStatus === "rejected") {
        skippedRejected++; // silent by design; counted in the log only
        continue;
      }
      if (existingStatus) {
        skippedExisting++;
        continue;
      }
      existingDomains.set(domain, "under_review");

      const { data: startup, error: sErr } = await sb
        .from("startups")
        .insert({
          name: candidate.name.slice(0, 200),
          website: candidate.website.slice(0, 500),
          domain,
          source: "scraped",
          status: "under_review",
          claimed: false,
          sourced_for: problemId,
        })
        .select("id")
        .single();
      if (sErr || !startup) continue;

      await sb.from("startup_profiles").insert({
        startup_id: startup.id,
        hq_country: candidate.hq_country?.toUpperCase() ?? null,
        poc_evidence: candidate.evidence,
        field_provenance: candidate.evidence
          ? { poc_evidence: "ai_inferred", hq_country: candidate.hq_country ? "ai_inferred" : undefined }
          : {},
      });

      // Full enrichment (site fetch + extraction + scoring + embedding).
      await sb.from("jobs").insert({
        type: "enrich_startup",
        payload: { startup_id: startup.id },
      });
      inserted++;
    }

    console.log(
      `[sourcing ${problemId}] found ${candidates.length}, inserted ${inserted}, ` +
        `skipped ${skippedExisting} existing, ${skippedRejected} rejected (silent)`
    );

    await sb
      .from("sourcing_runs")
      .update({ status: "completed", candidates_found: inserted })
      .eq("id", run.id);
  } catch (e) {
    await sb
      .from("sourcing_runs")
      .update({ status: "failed", candidates_found: 0 })
      .eq("id", run.id);
    throw e;
  }
}
