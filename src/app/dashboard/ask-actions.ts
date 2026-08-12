"use server";

import { revalidatePath } from "next/cache";
import { requireOfficer } from "@/lib/server/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { generateAskFacts, type AskFact } from "@/lib/askFacts";
import { enrichProblem, embedProblem } from "@/lib/pipeline";
import { runMatching, rankedMatches } from "@/lib/matching/engine";
import { readAsk, draftProblem } from "@/lib/intake";
import {
  checkSufficiency,
  type IntakeRead,
  type IntakeAnswer,
  type DraftedProblem,
  type Sufficiency,
} from "@/lib/intake-shared";

export interface AskOutcome {
  problemId: string;
  title: string;
  country: string | null;
  sector: string | null;
  description: string;
  /** Gaps the officer couldn't fill, carried through instead of invented. */
  openQuestions: string[];
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
 * Step 1 — read what they wrote, ask about what they didn't.
 *
 * Nothing is saved and nothing is drafted here. This exists so the
 * officer's own answers, not a model's assumptions, become the problem
 * statement.
 */
export async function beginIntake(
  ask: string
): Promise<IntakeRead | AskFailure> {
  try {
    await requireOfficer();
    const trimmed = ask.trim();
    if (trimmed.length < 8) throw new Error("Tell me a little more about the need.");
    if (trimmed.length > 2000) throw new Error("That's too long — a few sentences is plenty.");
    return await readAsk(trimmed);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error(`[intake:read] ${detail}`);
    return { failed: true, message: friendlyAskError(detail) };
  }
}

export interface DraftResult {
  draft: DraftedProblem;
  sufficiency: Sufficiency;
}

/**
 * Step 2 — draft from confirmed answers only, for review.
 *
 * Still no database write. The officer sees exactly what will be saved,
 * including the gaps, and can edit it before anything is committed.
 */
export async function draftFromIntake(
  ask: string,
  answers: IntakeAnswer[]
): Promise<DraftResult | AskFailure> {
  try {
    await requireOfficer();
    const sufficiency = checkSufficiency(answers);
    if (!sufficiency.ok) {
      // The gate holds server-side too — a client that skipped the
      // check still can't get a fabricated brief out of us.
      return { failed: true, message: sufficiency.message };
    }
    const draft = await draftProblem(ask.trim().slice(0, 2000), answers);
    return { draft, sufficiency };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error(`[intake:draft] ${detail}`);
    return { failed: true, message: friendlyAskError(detail) };
  }
}

/**
 * Step 3 — the officer signed off. Save, embed, match, and hunt if the
 * pool comes up short.
 *
 * Runs synchronously because they're watching: the brief is one Claude
 * call, embedding one, matching is local. Only sourcing is queued.
 */
export async function commitProblem(
  draft: DraftedProblem,
  answers: IntakeAnswer[]
): Promise<AskResult> {
  try {
    return await runAsk(draft, answers);
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

async function runAsk(
  draft: DraftedProblem,
  answers: IntakeAnswer[]
): Promise<AskOutcome> {
  await requireOfficer();
  const description = draft.description.trim();
  if (description.length < 20) throw new Error("The problem statement is too short to match on.");

  const admin = createSupabaseAdminClient();
  const { data: problem, error } = await admin
    .from("problems")
    .insert({
      title: draft.title.slice(0, 200),
      country: draft.country,
      sector: draft.sector,
      sdg_tags: draft.sdg_tags.length ? draft.sdg_tags : null,
      description,
      status: "draft",
      // Provenance: the brief can always be traced back to what a human
      // actually said, and the gaps stay on the record.
      intake_answers: answers,
      open_questions: draft.open_questions.length ? draft.open_questions : null,
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
    await admin.rpc("request_sourcing", { p_problem_id: problem.id });
    sourcing = "started";
  }

  revalidatePath("/dashboard/problems");
  return {
    problemId: problem.id,
    title: draft.title,
    country: draft.country,
    sector: draft.sector,
    description,
    openQuestions: draft.open_questions,
    matches: shape(ranked.matches),
    adjacent: shape(ranked.adjacent),
    threshold: ranked.threshold,
    sourcing,
  };
}

/**
 * Context cards for the loading screen. Called in parallel with
 * commitProblem, never awaited before it — a failure here must never cost
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
  // Collapses duplicates and moves the request to the front of the
  // foreground band — the hunt someone just asked for is the one that
  // runs next.
  const { error } = await admin.rpc("request_sourcing", {
    p_problem_id: problemId,
  });
  if (error) throw new Error(`request_sourcing: ${error.message}`);
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

  // How much work sits ahead of this hunt, so the UI can be specific
  // instead of spinning: "3 jobs ahead" beats an indefinite shimmer.
  const { data: ahead } = await admin.rpc("sourcing_queue_depth", {
    p_problem_id: problemId,
  });

  // Candidates from this problem still waiting to be profiled.
  const { count: profiling } = await admin
    .from("jobs")
    .select("*", { count: "exact", head: true })
    .eq("type", "enrich_startup")
    .in("status", ["queued", "running"]);

  return {
    status: run?.status ?? "queued",
    candidatesFound: run?.candidates_found ?? null,
    inQueue: count ?? 0,
    jobsAhead: typeof ahead === "number" ? ahead : 0,
    profiling: profiling ?? 0,
  };
}
