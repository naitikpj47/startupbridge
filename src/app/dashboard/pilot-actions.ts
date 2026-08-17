"use server";

import { revalidatePath } from "next/cache";
import { requireOfficer } from "@/lib/server/auth";
import {
  cleanBudget,
  cleanDuration,
  cleanMilestones,
  cleanObjectives,
  pathwayWithStage,
  PILOT_STATUSES,
  PILOT_OUTCOMES,
  SCALE_DECISIONS,
  PPP_STAGES,
  type PilotObjective,
  type PilotMilestone,
} from "@/lib/pilots-shared";

/**
 * Pilot terms and the PPP pathway — the write half.
 *
 * All writes go through the officer's own RLS-scoped client: pilots is
 * ordinary team data, not machinery, so the service role stays out of
 * it. Every action re-verifies that the match belongs to the problem
 * the caller says it does — ids arrive from the browser and are not
 * trusted to agree with each other.
 */

export interface PilotInput {
  budgetUsd: number;
  durationMonths: number;
  startedOn: string | null;
  objectives: PilotObjective[];
  milestones: PilotMilestone[];
}

/** Statuses a pilot can be designed against — a chosen startup, not a
 * mere suggestion. */
const DESIGNABLE = new Set(["shortlisted", "introduced", "engaged"]);

async function ownedMatch(
  sb: Awaited<ReturnType<typeof requireOfficer>>["sb"],
  problemId: string,
  matchId: string
) {
  const { data: match, error } = await sb
    .from("matches")
    .select("id, status, problem_id")
    .eq("id", matchId)
    .eq("problem_id", problemId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!match) throw new Error("That match doesn't belong to this problem.");
  return match;
}

export async function savePilot(
  problemId: string,
  matchId: string,
  input: PilotInput
): Promise<{ error?: string }> {
  const { sb } = await requireOfficer();

  const match = await ownedMatch(sb, problemId, matchId);
  if (!DESIGNABLE.has(match.status)) {
    return { error: "Shortlist the startup first — pilots are for chosen candidates." };
  }

  const budget = cleanBudget(input.budgetUsd);
  if (budget === null) return { error: "Budget must be a positive amount." };
  const duration = cleanDuration(input.durationMonths);
  if (duration === null) return { error: "Timeline must be between 1 and 60 months." };
  const objectives = cleanObjectives(input.objectives);
  if (objectives.length === 0) {
    return { error: "At least one objective — what is this pilot for?" };
  }
  const milestones = cleanMilestones(input.milestones, duration);
  const startedOn =
    input.startedOn && /^\d{4}-\d{2}-\d{2}$/.test(input.startedOn)
      ? input.startedOn
      : null;

  const { error } = await sb.from("pilots").upsert(
    {
      match_id: matchId,
      budget_usd: budget,
      duration_months: duration,
      started_on: startedOn,
      objectives,
      milestones,
    },
    { onConflict: "match_id" }
  );
  if (error) return { error: error.message };

  revalidatePath(`/dashboard/problems/${problemId}`);
  return {};
}

export async function setPilotStatus(
  problemId: string,
  matchId: string,
  status: string
): Promise<{ error?: string }> {
  const { sb } = await requireOfficer();
  await ownedMatch(sb, problemId, matchId);

  if (!(PILOT_STATUSES as readonly string[]).includes(status) || status === "completed") {
    // Completion goes through recordOutcome, never directly — the DB
    // check requires an outcome on a completed pilot.
    return { error: "Invalid status." };
  }

  const { error } = await sb
    .from("pilots")
    .update({ status })
    .eq("match_id", matchId);
  if (error) return { error: error.message };

  revalidatePath(`/dashboard/problems/${problemId}`);
  return {};
}

export async function recordPilotOutcome(
  problemId: string,
  matchId: string,
  outcome: string,
  notes: string
): Promise<{ error?: string }> {
  const { sb } = await requireOfficer();
  await ownedMatch(sb, problemId, matchId);

  if (!PILOT_OUTCOMES.some((o) => o.key === outcome)) {
    return { error: "Invalid outcome." };
  }

  const { error } = await sb
    .from("pilots")
    .update({
      status: "completed",
      outcome,
      outcome_notes: notes.trim().slice(0, 4000) || null,
    })
    .eq("match_id", matchId);
  if (error) return { error: error.message };

  revalidatePath(`/dashboard/problems/${problemId}`);
  return {};
}

export async function setScaleDecision(
  problemId: string,
  matchId: string,
  decision: string
): Promise<{ error?: string }> {
  const { sb } = await requireOfficer();
  await ownedMatch(sb, problemId, matchId);

  if (!SCALE_DECISIONS.some((d) => d.key === decision)) {
    return { error: "Invalid decision." };
  }

  const { error } = await sb
    .from("pilots")
    .update({ scale_decision: decision })
    .eq("match_id", matchId)
    .eq("status", "completed"); // the DB check backs this up
  if (error) return { error: error.message };

  revalidatePath(`/dashboard/problems/${problemId}`);
  return {};
}

export async function savePathwayStage(
  problemId: string,
  matchId: string,
  stageKey: string,
  done: boolean,
  note: string
): Promise<{ error?: string }> {
  const { sb } = await requireOfficer();
  await ownedMatch(sb, problemId, matchId);

  if (!PPP_STAGES.some((s) => s.key === stageKey)) {
    return { error: "Unknown stage." };
  }

  // Read-merge-write on the officer's own row; the merge normalizes to
  // the canonical stage list so junk keys never accumulate.
  const { data: pilot, error: rErr } = await sb
    .from("pilots")
    .select("scale_pathway, scale_decision")
    .eq("match_id", matchId)
    .maybeSingle();
  if (rErr) return { error: rErr.message };
  if (!pilot) return { error: "No pilot on this match yet." };
  if (pilot.scale_decision !== "recommend_ppp") {
    return { error: "The pathway opens once the pilot is recommended for PPP scale-up." };
  }

  const { error } = await sb
    .from("pilots")
    .update({ scale_pathway: pathwayWithStage(pilot.scale_pathway, stageKey, done, note) })
    .eq("match_id", matchId);
  if (error) return { error: error.message };

  revalidatePath(`/dashboard/problems/${problemId}`);
  return {};
}
