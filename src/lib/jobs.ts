import type { SupabaseClient } from "@supabase/supabase-js";
import {
  recomputeStartup,
  embedStartup,
  enrichProblem,
  embedProblem,
  enrichStartupFromWebsite,
} from "@/lib/pipeline";
import { generateMatchBriefing } from "@/lib/matching/briefing";
import { runPrefillJob } from "@/lib/prefillJob";
import { sourceCandidatesForProblem } from "@/lib/sourcing";

export type JobType =
  | "enrich_startup"
  | "recompute_startup"
  | "embed_startup"
  | "enrich_problem"
  | "embed_problem"
  | "generate_briefing"
  | "prefill_url"
  | "source_candidates";

export interface Job {
  id: string;
  type: JobType;
  payload: Record<string, string>;
  attempts: number;
  max_attempts: number;
}

export async function enqueueJob(
  sb: SupabaseClient,
  type: JobType,
  payload: Record<string, string>
): Promise<void> {
  const { error } = await sb.from("jobs").insert({ type, payload });
  if (error) throw new Error(`enqueue ${type}: ${error.message}`);
}

export async function processJob(sb: SupabaseClient, job: Job): Promise<void> {
  switch (job.type) {
    case "recompute_startup":
      return recomputeStartup(sb, job.payload.startup_id);
    case "embed_startup":
      return embedStartup(sb, job.payload.startup_id);
    case "enrich_problem":
      // A fresh brief changes the canonical problem text, so re-embed in
      // the same job — a brief written after an embed must never leave a
      // stale vector behind.
      await enrichProblem(sb, job.payload.problem_id);
      return embedProblem(sb, job.payload.problem_id);
    case "embed_problem":
      return embedProblem(sb, job.payload.problem_id);
    case "enrich_startup":
      return enrichStartupFromWebsite(sb, job.payload.startup_id);
    case "generate_briefing":
      return generateMatchBriefing(sb, job.payload.match_id);
    case "prefill_url":
      return runPrefillJob(sb, job.id, job.payload.url);
    case "source_candidates":
      return sourceCandidatesForProblem(sb, job.payload.problem_id);
    default:
      throw new Error(`Unknown job type: ${job.type as string}`);
  }
}

/** Persist a job status transition; a lost write here would strand the
 * job in 'running' forever, so retry hard and throw if it can't land. */
async function writeJobStatus(
  sb: SupabaseClient,
  jobId: string,
  fields: Record<string, unknown>
): Promise<void> {
  let lastMessage = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1500 * attempt));
    const { error } = await sb.from("jobs").update(fields).eq("id", jobId);
    if (!error) return;
    lastMessage = error.message;
  }
  throw new Error(`Could not persist status for job ${jobId}: ${lastMessage}`);
}

/**
 * Claim-and-process loop. Drain mode stops when the queue is empty;
 * otherwise polls every few seconds. Failures retry with linear backoff
 * until max_attempts, then stay 'failed' with the error recorded.
 */
export async function runWorker(
  sb: SupabaseClient,
  opts: {
    drain?: boolean;
    /** Stop after this many jobs (bounded ticks); unlimited by default. */
    maxJobs?: number;
    /** In drain mode, wait out retry backoffs (default true). Bounded
     * ticks set false and leave backed-off jobs to the next tick. */
    waitForBackoff?: boolean;
    onJob?: (job: Job, ok: boolean, err?: string) => void;
  } = {}
): Promise<{ succeeded: number; failed: number }> {
  let succeeded = 0;
  let failed = 0;

  for (;;) {
    if (
      opts.maxJobs !== undefined &&
      succeeded + failed >= opts.maxJobs
    ) {
      return { succeeded, failed };
    }
    const { data, error } = await sb.rpc("claim_next_jobs", { batch_size: 1 });
    if (error) throw new Error(`claim_next_jobs: ${error.message}`);
    const jobs = (data ?? []) as Job[];

    if (jobs.length === 0) {
      // Nothing claimable right now — but drain mode must not abandon
      // jobs waiting out their retry backoff (run_after in the future).
      if (opts.waitForBackoff === false) return { succeeded, failed };
      const { data: pending, error: pErr } = await sb
        .from("jobs")
        .select("run_after")
        .eq("status", "queued")
        .order("run_after")
        .limit(1);
      if (pErr) throw new Error(`checking pending jobs: ${pErr.message}`);

      if (!pending?.length) {
        if (opts.drain !== false) return { succeeded, failed };
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }
      const waitMs = Math.min(
        Math.max(new Date(pending[0].run_after).getTime() - Date.now(), 1000),
        30_000
      );
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }

    for (const job of jobs) {
      try {
        await processJob(sb, job);
        await writeJobStatus(sb, job.id, {
          status: "succeeded",
          finished_at: new Date().toISOString(),
          error: null,
        });
        succeeded++;
        opts.onJob?.(job, true);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const retriable = job.attempts < job.max_attempts;
        await writeJobStatus(
          sb,
          job.id,
          retriable
            ? {
                status: "queued",
                error: message,
                run_after: new Date(Date.now() + 30_000 * job.attempts).toISOString(),
              }
            : { status: "failed", error: message, finished_at: new Date().toISOString() }
        );
        if (!retriable) failed++;
        opts.onJob?.(job, false, message);
      }
    }
  }
}
