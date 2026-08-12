"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOfficer } from "@/lib/server/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { runMatching } from "@/lib/matching/engine";
import { normalizeDomain } from "@/lib/domain";

/** Enqueue jobs with the service role (the jobs table is read-only to
 * officers by design — the queue is machinery, not data). */
async function enqueue(type: string, payload: Record<string, string>) {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("jobs").insert({ type, payload });
  if (error) throw new Error(`enqueue ${type}: ${error.message}`);
}

// ── Review queue ────────────────────────────────────────────────────────

export async function approveStartup(startupId: string) {
  const { sb } = await requireOfficer();
  const { error } = await sb
    .from("startups")
    .update({ status: "approved" })
    .eq("id", startupId)
    .neq("status", "rejected"); // rejected never resurrects
  if (error) throw new Error(error.message);
  await enqueue("recompute_startup", { startup_id: startupId });
  await enqueue("embed_startup", { startup_id: startupId });
  revalidatePath("/dashboard/queue");
}

export async function rejectStartup(startupId: string) {
  const { sb } = await requireOfficer();
  const { error } = await sb
    .from("startups")
    .update({ status: "rejected" })
    .eq("id", startupId);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/queue");
}

/** Patch 12: reviewer can manually mark a profile claimed. */
export async function markClaimed(startupId: string) {
  const { sb } = await requireOfficer();
  const { error } = await sb
    .from("startups")
    .update({ claimed: true })
    .eq("id", startupId);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/queue");
  revalidatePath(`/dashboard/startups/${startupId}`);
}

// ── Problems ────────────────────────────────────────────────────────────

export async function createProblem(formData: FormData) {
  const { sb } = await requireOfficer();
  const title = String(formData.get("title") ?? "").trim();
  const country = String(formData.get("country") ?? "").trim().toUpperCase();
  const sector = String(formData.get("sector") ?? "").trim().toLowerCase();
  const description = String(formData.get("description") ?? "").trim();
  const sdgs = String(formData.get("sdg_tags") ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  if (!title) throw new Error("Title is required");

  const { data, error } = await sb
    .from("problems")
    .insert({
      title,
      country: /^[A-Z]{2}$/.test(country) ? country : null,
      sector: sector || null,
      description: description || null,
      sdg_tags: sdgs.length ? sdgs : null,
      status: "draft",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "insert failed");

  // Enrichment runs in the background; the officer confirms the brief
  // before the problem opens for matching.
  await enqueue("enrich_problem", { problem_id: data.id });
  revalidatePath("/dashboard/problems");
  redirect(`/dashboard/problems/${data.id}`);
}

export async function saveBrief(problemId: string, brief: string, open: boolean) {
  const { sb } = await requireOfficer();
  const updates: Record<string, unknown> = { enriched_brief: brief.trim() || null };
  if (open) updates.status = "open";
  const { error } = await sb.from("problems").update(updates).eq("id", problemId);
  if (error) throw new Error(error.message);
  if (open) await enqueue("embed_problem", { problem_id: problemId });
  revalidatePath(`/dashboard/problems/${problemId}`);
}

export async function closeProblem(problemId: string) {
  const { sb } = await requireOfficer();
  const { error } = await sb
    .from("problems")
    .update({ status: "closed" })
    .eq("id", problemId);
  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/problems/${problemId}`);
}

export async function runMatchingForProblem(problemId: string) {
  await requireOfficer();
  // The engine needs the similarity RPC (service-role only by design).
  const admin = createSupabaseAdminClient();
  await runMatching(admin, problemId);
  revalidatePath(`/dashboard/problems/${problemId}`);
}

// ── Matches ─────────────────────────────────────────────────────────────

const MATCH_STATUSES = ["suggested", "shortlisted", "introduced", "engaged", "dropped"];

export async function setMatchStatus(matchId: string, status: string) {
  const { sb } = await requireOfficer();
  if (!MATCH_STATUSES.includes(status)) throw new Error("Invalid status");
  const { data: match, error } = await sb
    .from("matches")
    .update({ status })
    .eq("id", matchId)
    .select("id, briefing_note, problem_id")
    .single();
  if (error || !match) throw new Error(error?.message ?? "update failed");

  // Spec: rationale + briefing generated on shortlist, stored, never
  // regenerated per view.
  if (status === "shortlisted" && !match.briefing_note) {
    await enqueue("generate_briefing", { match_id: matchId });
  }
  revalidatePath(`/dashboard/problems/${match.problem_id}`);
}

export async function regenerateBriefing(matchId: string) {
  const { sb } = await requireOfficer();
  const { data: match } = await sb
    .from("matches")
    .select("problem_id")
    .eq("id", matchId)
    .single();
  await enqueue("generate_briefing", { match_id: matchId });
  if (match) revalidatePath(`/dashboard/problems/${match.problem_id}`);
}

export async function addOutreach(matchId: string, formData: FormData) {
  const { sb } = await requireOfficer();
  const channel = String(formData.get("channel") ?? "").trim();
  const response = String(formData.get("response_status") ?? "pending");
  const notes = String(formData.get("notes") ?? "").trim();
  if (!["pending", "interested", "declined"].includes(response)) {
    throw new Error("Invalid response status");
  }
  const { data: match } = await sb
    .from("matches")
    .select("problem_id")
    .eq("id", matchId)
    .single();
  const { error } = await sb.from("outreach").insert({
    match_id: matchId,
    channel: channel || null,
    response_status: response,
    notes: notes || null,
  });
  if (error) throw new Error(error.message);
  if (match) revalidatePath(`/dashboard/problems/${match.problem_id}`);
}

// ── Config ──────────────────────────────────────────────────────────────

export async function saveConfig(formData: FormData) {
  const { sb } = await requireOfficer();

  const num = (key: string, min: number, max: number) => {
    const v = Number(formData.get(key));
    if (!Number.isFinite(v) || v < min || v > max) {
      throw new Error(`${key} must be between ${min} and ${max}`);
    }
    return v;
  };

  const weights = {
    similarity: num("weight_similarity", 0, 1),
    readiness: num("weight_readiness", 0, 1),
    context: num("weight_context", 0, 1),
    strategic: num("weight_strategic", 0, 1),
  };
  const weightSum =
    weights.similarity + weights.readiness + weights.context + weights.strategic;
  if (Math.abs(weightSum - 1) > 0.001) {
    throw new Error(`Final weights must sum to 1.00 (currently ${weightSum.toFixed(2)})`);
  }

  let countryWeights: Record<string, number>;
  try {
    countryWeights = JSON.parse(String(formData.get("country_weights") ?? "{}"));
    if (typeof countryWeights !== "object" || Array.isArray(countryWeights)) throw new Error();
    for (const [k, v] of Object.entries(countryWeights)) {
      if (typeof v !== "number" || v < 0 || v > 100) throw new Error();
      if (k !== "default" && !/^[A-Z]{2}$/.test(k)) throw new Error();
    }
  } catch {
    throw new Error('Partnership priority must be JSON like {"JP": 10, "default": 0} with uppercase ISO keys and weights 0-100');
  }

  const { error } = await sb
    .from("scoring_config")
    .update({
      similarity_threshold: num("similarity_threshold", 0, 1),
      weight_similarity: weights.similarity,
      weight_readiness: weights.readiness,
      weight_context: weights.context,
      weight_strategic: weights.strategic,
      adjacent_candidate_limit: num("adjacent_candidate_limit", 0, 10),
      country_weights: countryWeights,
    })
    .eq("id", true);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/config");
}

// ── CSV import ──────────────────────────────────────────────────────────

export interface CsvImportRow {
  name?: string;
  website?: string;
  tagline?: string;
  description?: string;
  contact_name?: string;
  contact_email?: string;
  sectors?: string;
  countries_active?: string;
  hq_country?: string;
  team_size?: string;
  funding_raised_usd?: string;
  stage?: string;
}

export async function importCsvRows(rows: CsvImportRow[]) {
  await requireOfficer();
  const admin = createSupabaseAdminClient();

  let imported = 0;
  let skippedDuplicates = 0;
  const errors: string[] = [];

  for (const row of rows.slice(0, 200)) {
    const name = row.name?.trim();
    const website = row.website?.trim();
    if (!name || !website) {
      errors.push(`Missing name or website: ${JSON.stringify(row).slice(0, 80)}`);
      continue;
    }
    const domain = normalizeDomain(website);
    if (!domain) {
      errors.push(`Bad website for ${name}`);
      continue;
    }

    const { data: existing } = await admin
      .from("startups")
      .select("id")
      .eq("domain", domain)
      .maybeSingle();
    if (existing) {
      skippedDuplicates++;
      continue;
    }

    const fields: Record<string, unknown> = {
      sectors: row.sectors
        ? row.sectors.split(/[|;]/).map((s) => s.trim().toLowerCase()).filter(Boolean)
        : null,
      countries_active: row.countries_active
        ? row.countries_active.split(/[|,;]/).map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z]{2}$/.test(s))
        : null,
      hq_country: row.hq_country && /^[A-Za-z]{2}$/.test(row.hq_country.trim())
        ? row.hq_country.trim().toUpperCase()
        : null,
      team_size: row.team_size && Number.isFinite(Number(row.team_size))
        ? Math.round(Number(row.team_size))
        : null,
      funding_raised_usd: row.funding_raised_usd && Number.isFinite(Number(row.funding_raised_usd))
        ? Number(row.funding_raised_usd)
        : null,
      stage: row.stage?.trim() || null,
    };

    const provenance: Record<string, string> = {};
    if (row.tagline?.trim()) provenance.tagline = "premium_db";
    if (row.description?.trim()) provenance.description = "premium_db";
    for (const key of ["sectors", "countries_active", "hq_country", "team_size", "funding_raised_usd", "stage"]) {
      if (fields[key] !== null) provenance[key] = "premium_db";
    }

    const { data: startup, error: sErr } = await admin
      .from("startups")
      .insert({
        name: name.slice(0, 200),
        website,
        domain,
        tagline: row.tagline?.trim() || null,
        description: row.description?.trim() || null,
        contact_name: row.contact_name?.trim() || null,
        contact_email: row.contact_email?.trim() || null,
        source: "csv_import",
        status: "under_review",
        claimed: false,
      })
      .select("id")
      .single();
    if (sErr || !startup) {
      errors.push(`${name}: ${sErr?.message ?? "insert failed"}`);
      continue;
    }

    const { error: pErr } = await admin.from("startup_profiles").insert({
      startup_id: startup.id,
      ...fields,
      field_provenance: provenance,
    });
    if (pErr) {
      errors.push(`${name} (profile): ${pErr.message}`);
      continue;
    }

    await enqueue("recompute_startup", { startup_id: startup.id });
    await enqueue("embed_startup", { startup_id: startup.id });
    imported++;
  }

  revalidatePath("/dashboard/queue");
  revalidatePath("/dashboard/import");
  return { imported, skippedDuplicates, errors: errors.slice(0, 20) };
}

// ── Session ─────────────────────────────────────────────────────────────

export async function signOut() {
  const sb = await createSupabaseServerClient();
  await sb.auth.signOut();
  redirect("/signin");
}
