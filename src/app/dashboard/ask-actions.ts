"use server";

import { revalidatePath } from "next/cache";
import { requireOfficer } from "@/lib/server/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { structureAsk } from "@/lib/ask";
import { generateAskFacts, type AskFact } from "@/lib/askFacts";
import { enrichProblem, embedProblem } from "@/lib/pipeline";
import { runMatching, rankedMatches } from "@/lib/matching/engine";

export interface AskOutcome {
  problemId: string;
  title: string;
  country: string | null;
  sector: string | null;
  description: string;
  matches: {
    id: string;
    name: string;
    startupId: string;
    finalScore: number;
    similarity: number;
    readiness: number | null;
    confidence: string | null;
    contextFit: number | null;
  }[];
  adjacent: AskOutcome["matches"];
  threshold: number;
  sourcing: "not-needed" | "started";
}

export interface AskFailure {
  failed: true;
  message: string;
}

export type AskResult = AskOutcome | AskFailure;

/**
 * The centerpiece. One sentence in; a structured problem, a drafted
 * brief, an embedding, a scored match run, and — when nothing clears the
 * bar — an automatic external hunt, out.
 *
 * Runs synchronously because the officer is watching: structuring and
 * the brief are two fast Claude calls, embedding is one, matching is
 * local. Only sourcing (slow, web-searching) is queued.
 */
export async function askForHelp(ask: string): Promise<AskResult> {
  try {
    return await runAsk(ask);
  } catch (e) {
    // A thrown Server Action error reaches the browser stripped of its
    // message (React #441), which tells the officer nothing. Catch it
    // here and hand back something they can act on, while the real
    // cause goes to the server log.
    const detail = e instanceof Error ? e.message : String(e);
    console.error(`[ask] failed: ${detail}`);
    return { failed: true, message: friendlyAskError(detail) };
  }
}

function friendlyAskError(detail: string): string {
  const d = detail.toLowerCase();
  if (d.includes("credit") || d.includes("quota") || d.includes("insufficient")) {
    return "The AI account is out of credit — top it up and try again.";
  }
  if (d.includes("timeout") || d.includes("timed out") || d.includes("aborted")) {
    return "That took longer than the server allows. Try a shorter, more specific description.";
  }
  if (d.includes("rate") && d.includes("limit")) {
    return "Rate limited by the AI provider — wait a moment and try again.";
  }
  if (d.includes("refus")) {
    return "The model declined to process that phrasing. Try describing the need differently.";
  }
  return `Something went wrong: ${detail.slice(0, 200)}`;
}

async function runAsk(ask: string): Promise<AskOutcome> {
  await requireOfficer();
  const trimmed = ask.trim();
  if (trimmed.length < 8) throw new Error("Tell me a little more about the need.");
  if (trimmed.length > 2000) throw new Error("That's too long — a few sentences is plenty.");

  const admin = createSupabaseAdminClient();
  const structured = await structureAsk(trimmed);

  const { data: problem, error } = await admin
    .from("problems")
    .insert({
      title: structured.title.slice(0, 200),
      country: structured.country && /^[A-Z]{2}$/i.test(structured.country)
        ? structured.country.toUpperCase()
        : null,
      sector: structured.sector?.toLowerCase() ?? null,
      sdg_tags: structured.sdg_tags.length ? structured.sdg_tags.slice(0, 3) : null,
      description: structured.description,
      status: "draft",
    })
    .select("id")
    .single();
  if (error || !problem) throw new Error(`Could not save the problem: ${error?.message}`);

  // Brief + embedding, then open for matching.
  await enrichProblem(admin, problem.id);
  await embedProblem(admin, problem.id);
  await admin.from("problems").update({ status: "open" }).eq("id", problem.id);

  await runMatching(admin, problem.id);
  const ranked = await rankedMatches(admin, problem.id);

  const shape = (rows: typeof ranked.matches) =>
    rows.map((m) => ({
      id: m.id,
      name: m.name,
      startupId: m.startup_id,
      finalScore: m.final_score,
      similarity: m.similarity,
      readiness: m.base_readiness,
      confidence: m.data_confidence,
      contextFit: m.context_fit,
    }));

  // Spec: one automatic sourcing run per problem when nothing clears.
  let sourcing: AskOutcome["sourcing"] = "not-needed";
  if (ranked.matches.length === 0) {
    await admin.from("jobs").insert({
      type: "source_candidates",
      payload: { problem_id: problem.id },
    });
    sourcing = "started";
  }

  revalidatePath("/dashboard/problems");
  return {
    problemId: problem.id,
    title: structured.title,
    country: structured.country,
    sector: structured.sector,
    description: structured.description,
    matches: shape(ranked.matches),
    adjacent: shape(ranked.adjacent),
    threshold: ranked.threshold,
    sourcing,
  };
}

/**
 * Context cards for the loading screen. Called in parallel with
 * askForHelp, never awaited before it — a failure here must never cost
 * the officer their answer, so it returns an empty list instead.
 */
export async function askForFacts(ask: string): Promise<AskFact[]> {
  try {
    await requireOfficer();
    return await generateAskFacts(ask.trim().slice(0, 2000));
  } catch (e) {
    console.error(`[ask-facts] ${e instanceof Error ? e.message : e}`);
    return [];
  }
}

/** Manual re-trigger of the external hunt (spec: auto once, then manual). */
export async function sourceExternally(problemId: string) {
  await requireOfficer();
  const admin = createSupabaseAdminClient();
  await admin.from("jobs").insert({
    type: "source_candidates",
    payload: { problem_id: problemId },
  });
  revalidatePath(`/dashboard/problems/${problemId}`);
}

/** How a queued/running hunt is going, for the polling UI. */
export async function sourcingStatus(problemId: string) {
  await requireOfficer();
  const admin = createSupabaseAdminClient();
  const { data: run } = await admin
    .from("sourcing_runs")
    .select("status, candidates_found, run_at")
    .eq("problem_id", problemId)
    .order("run_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { count } = await admin
    .from("startups")
    .select("*", { count: "exact", head: true })
    .eq("sourced_for", problemId);
  return {
    status: run?.status ?? "queued",
    candidatesFound: run?.candidates_found ?? null,
    inQueue: count ?? 0,
  };
}
