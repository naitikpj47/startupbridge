"use server";

import { revalidatePath } from "next/cache";
import { requireOfficer } from "@/lib/server/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadMatchingConfig } from "@/lib/matching/engine";

/**
 * What one hunt turned up — as its own list, not a queue.
 *
 * The review queue is a global inbox: every self-serve submission, every
 * CSV import, every previous hunt. Sending an officer there to find the
 * six companies that were just found for the problem in front of them is
 * the wrong destination. These actions back a picker on the problem
 * itself: here is what came back, choose who is worth the deep analysis.
 *
 * The picking matters because analysis is not free. Each candidate costs
 * a site fetch and a model call, so running it on all of them by default
 * spends real money on companies nobody has looked at yet. Judgement
 * first, spend second.
 */

export interface Finding {
  id: string;
  name: string;
  domain: string | null;
  website: string | null;
  hqCountry: string | null;
  /** Why the hunt picked them — the deployment evidence it found. */
  evidence: string | null;
  status: string;
  /** The analysis chain has run to completion for this candidate. */
  analysed: boolean;
  /** Analysis is queued or running right now. */
  pending: boolean;
  /** Analysis was attempted and gave up. Reason is human-readable. */
  failed: string | null;
  readiness: number | null;
  confidence: string | null;
  pocStatus: string | null;
  infraIntensity: string | null;
  sectors: string[] | null;
  /** Cosine similarity to this problem. Null until analysed. */
  similarity: number | null;
}

export interface FindingsView {
  findings: Finding[];
  /** The similarity bar this problem's matches have to clear. */
  threshold: number;
  /** Candidates still waiting on, or inside, analysis. */
  analysing: number;
}

/** Everything this problem's hunts have surfaced, freshest first. */
export async function huntFindings(problemId: string): Promise<FindingsView> {
  await requireOfficer();
  const admin = createSupabaseAdminClient();

  const { data: rows, error } = await admin
    .from("startups")
    .select(
      "id, name, domain, website, status, created_at, " +
        "startup_profiles(base_readiness, data_confidence, poc_evidence, " +
        "hq_country, poc_status, infra_intensity, sectors)"
    )
    .eq("sourced_for", problemId)
    .neq("status", "rejected")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`loading findings: ${error.message}`);

  // Concatenated select strings defeat supabase-js's literal type parser.
  const startupRows = (rows ?? []) as unknown as {
    id: string;
    name: string;
    domain: string | null;
    website: string | null;
    status: string;
    startup_profiles:
      | Record<string, unknown>
      | Record<string, unknown>[]
      | null;
  }[];
  const ids = startupRows.map((r) => r.id);
  if (ids.length === 0) {
    const config = await loadMatchingConfig(admin);
    return { findings: [], threshold: config.similarityThreshold, analysing: 0 };
  }

  // Analysis jobs for these candidates. Payload is jsonb, so filter in
  // JS rather than build an `or` of jsonb path predicates. Failures are
  // fetched too: a candidate whose site blocks the fetcher must say so,
  // not quietly revert to looking like it was never analysed. Roughly
  // two in five sourced domains are unreachable in practice.
  const { data: jobRows } = await admin
    .from("jobs")
    .select("payload, status, error, created_at")
    .eq("type", "enrich_startup")
    .in("status", ["queued", "running", "failed"])
    .order("created_at", { ascending: false });
  const inFlight = new Set<string>();
  const lastFailure = new Map<string, string>();
  for (const j of jobRows ?? []) {
    const sid = (j.payload as { startup_id?: string })?.startup_id;
    if (typeof sid !== "string") continue;
    if (j.status === "failed") {
      // Rows are newest-first, so the first failure seen is the latest.
      if (!lastFailure.has(sid)) lastFailure.set(sid, j.error ?? "unknown error");
    } else {
      inFlight.add(sid);
    }
  }

  // Similarity is only meaningful once a candidate has an embedding,
  // which analysis writes. Unanalysed rows simply come back absent.
  const { data: sims } = await admin.rpc("problem_similarities", {
    p_problem_id: problemId,
  });
  const simByStartup = new Map(
    ((sims ?? []) as { startup_id: string; similarity: number }[]).map((s) => [
      s.startup_id,
      s.similarity,
    ])
  );

  const config = await loadMatchingConfig(admin);

  const findings: Finding[] = startupRows.map((r) => {
    const p = (Array.isArray(r.startup_profiles)
      ? r.startup_profiles[0]
      : r.startup_profiles) as
      | {
          base_readiness: number | null;
          data_confidence: string | null;
          poc_evidence: string | null;
          hq_country: string | null;
          poc_status: string | null;
          infra_intensity: string | null;
          sectors: string[] | null;
        }
      | null;
    // Completion, not score — and the marker has been wrong twice, so
    // the reasoning matters. base_readiness is NULL after a successful
    // analysis (website enrichment writes none of the six readiness
    // signals). profile_text looked right but is rebuilt by ANY
    // recompute — the pg_cron sweep wrote it for candidates whose sites
    // were never fetched, which the live test caught. The embedding is
    // the artifact that only the end of the analysis chain produces,
    // and it is also the point of the exercise: analysed means
    // scoreable, scoreable means embedded. The similarity RPC returns
    // exactly the embedded rows, so presence in its result IS the flag.
    const analysed = simByStartup.has(r.id);
    return {
      id: r.id,
      name: r.name,
      domain: r.domain,
      website: r.website,
      hqCountry: p?.hq_country ?? null,
      evidence: p?.poc_evidence ?? null,
      status: r.status,
      analysed,
      pending: inFlight.has(r.id),
      failed: analysed || inFlight.has(r.id) ? null : (lastFailure.get(r.id) ?? null),
      readiness: p?.base_readiness ?? null,
      confidence: p?.data_confidence ?? null,
      pocStatus: p?.poc_status ?? null,
      infraIntensity: p?.infra_intensity ?? null,
      sectors: p?.sectors ?? null,
      similarity: simByStartup.get(r.id) ?? null,
    };
  });

  return {
    findings,
    threshold: config.similarityThreshold,
    analysing: findings.filter((f) => f.pending).length,
  };
}

/**
 * Run the deep analysis on the candidates the officer picked.
 *
 * Foreground priority (10): someone is sitting in front of this. One
 * enrich job fetches the site, extracts the profile, recomputes
 * readiness and re-embeds, so a single job per candidate is all it takes
 * to make them scoreable.
 */
export async function analyseCandidates(
  problemId: string,
  startupIds: string[]
): Promise<{ queued: number }> {
  await requireOfficer();
  if (startupIds.length === 0) return { queued: 0 };
  const admin = createSupabaseAdminClient();

  // Only candidates that really belong to this problem, and only ones
  // not already in flight — a double-click must not double-spend.
  const { data: owned } = await admin
    .from("startups")
    .select("id")
    .eq("sourced_for", problemId)
    .in("id", startupIds.slice(0, 25));
  const allowed = (owned ?? []).map((r) => r.id);
  if (allowed.length === 0) return { queued: 0 };

  const { data: jobRows } = await admin
    .from("jobs")
    .select("payload")
    .eq("type", "enrich_startup")
    .in("status", ["queued", "running"]);
  const inFlight = new Set(
    (jobRows ?? [])
      .map((j) => (j.payload as { startup_id?: string })?.startup_id)
      .filter((v): v is string => typeof v === "string")
  );

  const toQueue = allowed.filter((id) => !inFlight.has(id));
  if (toQueue.length === 0) return { queued: 0 };

  const { error } = await admin.from("jobs").insert(
    toQueue.map((id) => ({
      type: "enrich_startup",
      payload: { startup_id: id },
      priority: 10,
    }))
  );
  if (error) throw new Error(`queueing analysis: ${error.message}`);

  revalidatePath(`/dashboard/problems/${problemId}`);
  return { queued: toQueue.length };
}

/**
 * Take a candidate into the matching pool. Approving re-scores and
 * re-embeds, so they appear in the next match run for every open
 * problem, not only this one.
 */
export async function acceptCandidate(problemId: string, startupId: string) {
  const { sb } = await requireOfficer();
  const { error } = await sb
    .from("startups")
    .update({ status: "approved" })
    .eq("id", startupId)
    .eq("sourced_for", problemId)
    .neq("status", "rejected"); // rejected never resurrects
  if (error) throw new Error(error.message);

  const admin = createSupabaseAdminClient();
  await admin.from("jobs").insert([
    { type: "recompute_startup", payload: { startup_id: startupId }, priority: 10 },
    { type: "embed_startup", payload: { startup_id: startupId }, priority: 10 },
  ]);
  revalidatePath(`/dashboard/problems/${problemId}`);
}

/** Drop a candidate. Rejections never resurface in a later hunt. */
export async function dismissCandidate(problemId: string, startupId: string) {
  const { sb } = await requireOfficer();
  const { error } = await sb
    .from("startups")
    .update({ status: "rejected" })
    .eq("id", startupId)
    .eq("sourced_for", problemId);
  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/problems/${problemId}`);
}
