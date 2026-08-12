import type { SupabaseClient } from "@supabase/supabase-js";
import { evaluateGate } from "@/lib/matching/gate";
import {
  computeContextFit,
  computeStrategicFit,
  computeFinalScore,
  type ContextWeights,
  type FinalScoreWeights,
} from "@/lib/matching/scoring";

export interface MatchingConfig {
  similarityThreshold: number;
  adjacentLimit: number;
  contextWeights: ContextWeights;
  countryWeights: Record<string, number>;
  finalWeights: FinalScoreWeights;
}

export async function loadMatchingConfig(
  sb: SupabaseClient
): Promise<MatchingConfig> {
  const { data, error } = await sb.from("scoring_config").select("*").single();
  if (error || !data) {
    throw new Error(`loading scoring_config: ${error?.message}`);
  }
  return {
    similarityThreshold: Number(data.similarity_threshold),
    adjacentLimit: data.adjacent_candidate_limit,
    contextWeights: data.context_weights as ContextWeights,
    countryWeights: data.country_weights as Record<string, number>,
    finalWeights: {
      similarity: Number(data.weight_similarity),
      readiness: Number(data.weight_readiness),
      context: Number(data.weight_context),
      strategic: Number(data.weight_strategic),
    },
  };
}

async function loadRegionMap(
  sb: SupabaseClient
): Promise<Map<string, string>> {
  const { data, error } = await sb.from("country_regions").select("*");
  if (error || !data) throw new Error(`loading country_regions: ${error?.message}`);
  return new Map(data.map((r: { country: string; region: string }) => [r.country, r.region]));
}

export interface MatchRunResult {
  problemId: string;
  upserted: number;
  excludedByGate: { name: string; reasons: string[] }[];
  aboveThreshold: number;
}

/**
 * Run (or re-run) matching for one problem. UPSERT on
 * (problem_id, startup_id): scores refresh, rows never duplicate, and
 * status / rationale / briefing / outreach are untouched — the payload
 * simply doesn't contain them. Gated startups are excluded from every
 * surface via the ONE shared gate; their verify-flags are recorded on
 * the startup (deduped in SQL).
 */
export async function runMatching(
  sb: SupabaseClient,
  problemId: string
): Promise<MatchRunResult> {
  const config = await loadMatchingConfig(sb);
  const regions = await loadRegionMap(sb);
  const regionOf = (iso: string) => regions.get(iso.toUpperCase());

  const { data: problem, error: pErr } = await sb
    .from("problems")
    .select("id, country, sector, sdg_tags, status, embedding")
    .eq("id", problemId)
    .single();
  if (pErr || !problem) throw new Error(`loading problem: ${pErr?.message}`);
  if (problem.embedding === null) {
    // Distinguish a pipeline gap from a genuinely empty candidate pool —
    // an un-embedded problem must never masquerade as "no matches".
    throw new Error(
      `problem ${problemId} has no embedding — run the embedding pipeline first`
    );
  }

  const { data: sims, error: sErr } = await sb.rpc("problem_similarities", {
    p_problem_id: problemId,
  });
  if (sErr) throw new Error(`problem_similarities: ${sErr.message}`);

  const candidates = (sims as {
    startup_id: string;
    name: string;
    status: string;
    similarity: number;
  }[]).filter((c) => c.status === "approved");

  const ids = candidates.map((c) => c.startup_id);
  const { data: profiles, error: prErr } = await sb
    .from("startup_profiles")
    .select("*")
    .in("startup_id", ids);
  if (prErr || !profiles) throw new Error(`loading profiles: ${prErr?.message}`);
  const profileByStartup = new Map(profiles.map((p) => [p.startup_id, p]));

  const rows: Record<string, unknown>[] = [];
  const excludedByGate: { name: string; reasons: string[] }[] = [];
  const flagOps: { startup_id: string; flags: unknown }[] = [];
  let aboveThreshold = 0;

  for (const candidate of candidates) {
    const profile = profileByStartup.get(candidate.startup_id);
    if (!profile) continue;

    const gate = evaluateGate(profile);
    if (!gate.eligible) {
      excludedByGate.push({ name: candidate.name, reasons: gate.exclusionReasons });
      continue;
    }
    if (gate.verifyFlags.length) {
      flagOps.push({ startup_id: candidate.startup_id, flags: gate.verifyFlags });
    }

    // Cosine similarity of unrelated texts can dip below 0 (and float
    // error can nudge past 1); the DB check and final_score both expect
    // [0, 1], so clamp before scoring and storing.
    const similarity = Math.max(0, Math.min(1, candidate.similarity));

    const contextFit = computeContextFit(
      problem,
      profile,
      config.contextWeights,
      regionOf
    );
    const strategicFit = computeStrategicFit(
      profile.hq_country,
      config.countryWeights
    );
    const finalScore = computeFinalScore(
      similarity,
      profile.base_readiness,
      contextFit,
      strategicFit,
      config.finalWeights
    );

    if (similarity >= config.similarityThreshold) aboveThreshold++;

    rows.push({
      problem_id: problemId,
      startup_id: candidate.startup_id,
      similarity,
      context_fit: contextFit,
      strategic_fit: strategicFit,
      final_score: finalScore,
    });
  }

  const flagResults = await Promise.all(
    flagOps.map((op) =>
      sb.rpc("append_review_flags", {
        p_startup_id: op.startup_id,
        p_flags: op.flags,
      })
    )
  );
  const flagErr = flagResults.find((r) => r.error)?.error;
  if (flagErr) throw new Error(`append_review_flags: ${flagErr.message}`);

  if (rows.length) {
    const { error: uErr } = await sb
      .from("matches")
      .upsert(rows, { onConflict: "problem_id,startup_id" });
    if (uErr) throw new Error(`upserting matches: ${uErr.message}`);
  }

  return { problemId, upserted: rows.length, excludedByGate, aboveThreshold };
}

export interface RankedMatches {
  matches: MatchRow[];
  adjacent: MatchRow[];
  threshold: number;
}

export interface MatchRow {
  id: string;
  startup_id: string;
  name: string;
  similarity: number;
  context_fit: number | null;
  strategic_fit: number;
  final_score: number;
  status: string;
  base_readiness: number | null;
  data_confidence: string | null;
}

/**
 * Read a problem's matches for display: above-threshold ranked by
 * final_score, and — when nothing clears the threshold — up to N
 * clearly-labeled adjacent candidates. The gate re-applies at read time
 * so a startup gated since the last run never resurfaces.
 */
export async function rankedMatches(
  sb: SupabaseClient,
  problemId: string
): Promise<RankedMatches> {
  const config = await loadMatchingConfig(sb);

  const { data, error } = await sb
    .from("matches")
    .select(
      "id, startup_id, similarity, context_fit, strategic_fit, final_score, status, startups(name, status, startup_profiles(poc_status, infra_intensity, field_provenance, base_readiness, data_confidence))"
    )
    .eq("problem_id", problemId)
    .order("final_score", { ascending: false })
    .order("similarity", { ascending: false })
    .order("id");
  if (error) throw new Error(`loading matches: ${error.message}`);

  const rows: MatchRow[] = [];
  for (const m of data ?? []) {
    const startup = Array.isArray(m.startups) ? m.startups[0] : m.startups;
    if (!startup) continue;
    // Re-check approval at read time: a startup rejected after the last
    // match run must never resurface on any matching surface.
    if (startup.status !== "approved") continue;
    const profile = Array.isArray(startup.startup_profiles)
      ? startup.startup_profiles[0]
      : startup.startup_profiles;
    if (!profile || !evaluateGate(profile).eligible) continue;
    rows.push({
      id: m.id,
      startup_id: m.startup_id,
      name: startup.name,
      similarity: m.similarity,
      context_fit: m.context_fit,
      strategic_fit: m.strategic_fit,
      final_score: m.final_score,
      status: m.status,
      base_readiness: profile.base_readiness,
      data_confidence: profile.data_confidence,
    });
  }

  const above = rows.filter((r) => r.similarity >= config.similarityThreshold);
  // Adjacency means near-misses on SIMILARITY — sort the below-threshold
  // pool by similarity (not final_score) before taking the top N.
  const adjacent =
    above.length === 0
      ? rows
          .filter((r) => r.similarity < config.similarityThreshold)
          .sort((a, b) => b.similarity - a.similarity || a.id.localeCompare(b.id))
          .slice(0, config.adjacentLimit)
      : [];

  return { matches: above, adjacent, threshold: config.similarityThreshold };
}

/**
 * Profile changed → refresh final_score (and context/strategic) on
 * matches of OPEN problems only; closed problems stay frozen.
 */
export async function refreshOpenMatchScores(
  sb: SupabaseClient,
  startupId: string
): Promise<number> {
  const { data: matches, error } = await sb
    .from("matches")
    .select("id, problem_id, similarity, problems!inner(id, country, sector, sdg_tags, status)")
    .eq("startup_id", startupId)
    .in("problems.status", ["open", "matching"]);
  if (error) throw new Error(`loading open matches: ${error.message}`);
  if (!matches?.length) return 0;

  const config = await loadMatchingConfig(sb);
  const regions = await loadRegionMap(sb);
  const regionOf = (iso: string) => regions.get(iso.toUpperCase());

  const { data: profile, error: prErr } = await sb
    .from("startup_profiles")
    .select("*")
    .eq("startup_id", startupId)
    .single();
  if (prErr || !profile) throw new Error(`loading profile: ${prErr?.message}`);

  const rows = matches.map((m) => {
    const problem = Array.isArray(m.problems) ? m.problems[0] : m.problems;
    const contextFit = computeContextFit(problem, profile, config.contextWeights, regionOf);
    const strategicFit = computeStrategicFit(profile.hq_country, config.countryWeights);
    return {
      problem_id: m.problem_id,
      startup_id: startupId,
      similarity: m.similarity,
      context_fit: contextFit,
      strategic_fit: strategicFit,
      final_score: computeFinalScore(
        m.similarity,
        profile.base_readiness,
        contextFit,
        strategicFit,
        config.finalWeights
      ),
    };
  });

  // Same score-columns-only upsert shape as runMatching — one round trip,
  // status/rationale/briefing/outreach untouched.
  const { error: uErr } = await sb
    .from("matches")
    .upsert(rows, { onConflict: "problem_id,startup_id" });
  if (uErr) throw new Error(`refreshing matches for ${startupId}: ${uErr.message}`);
  return matches.length;
}
