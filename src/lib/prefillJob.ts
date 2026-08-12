import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchWebsiteText, extractStartupProfile } from "@/lib/enrichment/startup";
import { normalizeDomain } from "@/lib/domain";

/**
 * The queued URL pre-fill job (patch 10): fetch the site, extract a
 * profile with Claude, note whether the domain already exists (claim
 * flow branch), and store everything in jobs.result for the polling UI.
 */
export async function runPrefillJob(
  sb: SupabaseClient,
  jobId: string,
  url: string
): Promise<void> {
  const domain = normalizeDomain(url);
  if (!domain) throw new Error("Could not derive a domain from that URL");

  const { data: existing } = await sb
    .from("startups")
    .select("id, source, claimed")
    .eq("domain", domain)
    .maybeSingle();

  const existingStatus = existing
    ? existing.source === "scraped" && !existing.claimed
      ? "claimable"
      : "duplicate"
    : null;

  // No need to enrich a site we already know — the claim/duplicate
  // branch short-circuits in the UI.
  let extracted = null;
  if (!existingStatus) {
    const siteText = await fetchWebsiteText(url);
    const name = domain.split(".")[0];
    extracted = await extractStartupProfile(siteText, name);
  }

  const { error } = await sb
    .from("jobs")
    .update({ result: { domain, existing: existingStatus, extracted } })
    .eq("id", jobId);
  if (error) throw new Error(`storing prefill result: ${error.message}`);
}
