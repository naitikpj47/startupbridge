import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOfficer } from "@/lib/server/auth";
import { evaluateGate } from "@/lib/matching/gate";
import { markClaimed } from "../../actions";
import { BigScore, ConfidenceChip, StatusChip, FlagList, PageTitle } from "../../bits";
import type { ReviewFlag } from "@/lib/provenance";
import { countryNames } from "@/lib/countries";

export const dynamic = "force-dynamic";

export default async function StartupDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { sb } = await requireOfficer();
  const { id } = await params;

  const { data: raw } = await sb
    .from("startups")
    .select(
      "*, startup_profiles(*), affiliations(org_name, org_type, relationship, verified), " +
        "matches(id, final_score, similarity, status, problems(id, title))"
    )
    .eq("id", id)
    .maybeSingle();
  if (!raw) notFound();
  // Concatenated select strings defeat supabase-js's literal type parser.
  type ProfileRow = {
    poc_status: "none" | "pilot_completed" | "deployed_in_field" | null;
    infra_intensity: "plug_and_play" | "moderate" | "heavy" | null;
    field_provenance: Record<string, string> | null;
    base_readiness: number | null;
    data_confidence: string | null;
    poc_evidence: string | null;
    gov_experience: boolean | null;
    funding_raised_usd: number | string | null;
    team_size: number | null;
    stage: string | null;
    hq_country: string | null;
    countries_active: string[] | null;
    sectors: string[] | null;
    sdg_tags: string[] | null;
  };
  const s = raw as unknown as {
    id: string;
    name: string;
    domain: string | null;
    source: string;
    status: string;
    claimed: boolean;
    tagline: string | null;
    description: string | null;
    contact_name: string | null;
    contact_email: string | null;
    review_flags: unknown;
    startup_profiles: ProfileRow | ProfileRow[] | null;
    affiliations: { org_name: string; org_type: string; relationship: string; verified: boolean }[] | null;
    matches:
      | { id: string; final_score: number; similarity: number; status: string; problems: { id: string; title: string } | { id: string; title: string }[] }[]
      | null;
  };

  const p = Array.isArray(s.startup_profiles) ? s.startup_profiles[0] : s.startup_profiles;
  const gate = p ? evaluateGate(p) : null;
  const flags = (s.review_flags ?? []) as ReviewFlag[];
  const provenance = (p?.field_provenance ?? {}) as Record<string, string>;

  const fact = (label: string, value: React.ReactNode, provKey?: string) => (
    <div className="border-b border-line py-2.5 last:border-b-0">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-xs uppercase tracking-wider text-ink-secondary">{label}</span>
        <span className="text-right text-sm text-ink">{value ?? "—"}</span>
      </div>
      {provKey && provenance[provKey] && (
        <p className="mt-0.5 text-right text-[11px] text-ink-faint">{provenance[provKey].replace("_", " ")}</p>
      )}
    </div>
  );

  return (
    <div>
      <div className="flex items-start justify-between gap-6">
        <PageTitle title={s.name} sub={`${s.domain ?? ""} · ${s.source.replace("_", " ")}`} />
        <div className="flex items-center gap-2 pt-2">
          <StatusChip status={s.status} />
          {s.claimed ? (
            <span className="text-xs text-forest-deep">claimed</span>
          ) : (
            <form action={markClaimed.bind(null, s.id)}>
              <button className="text-xs text-ink-faint underline-offset-2 hover:text-ink hover:underline">
                Mark claimed
              </button>
            </form>
          )}
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <div className="border border-line bg-surface p-5">
            {s.tagline && <p className="text-sm font-medium text-ink">{s.tagline}</p>}
            <p className="mt-2 text-sm leading-relaxed text-ink-secondary">
              {s.description ?? "No description on file."}
            </p>
            {p?.poc_evidence && (
              <div className="mt-4 border-t border-line pt-3">
                <p className="text-xs uppercase tracking-wider text-ink-secondary">PoC evidence</p>
                <p className="mt-1 whitespace-pre-line text-sm text-ink">{p.poc_evidence}</p>
              </div>
            )}
          </div>

          {gate && !gate.eligible && (
            <div className="border border-warn bg-warn-tint p-4">
              <p className="text-sm font-medium text-warn">
                Excluded from matching: {gate.exclusionReasons.join("; ")}
              </p>
              <p className="mt-1 text-xs text-warn">{gate.founderCopy}</p>
            </div>
          )}
          <FlagList flags={flags} />

          {(s.affiliations?.length ?? 0) > 0 && (
            <div className="border border-line bg-surface p-5">
              <h2 className="text-sm font-semibold text-ink">Affiliations</h2>
              <ul className="mt-2 space-y-1.5">
                {s.affiliations!.map((a: { org_name: string; org_type: string; relationship: string; verified: boolean }, i: number) => (
                  <li key={i} className="flex items-center justify-between text-sm">
                    <span className="text-ink">
                      {a.org_name}
                      <span className="ml-2 text-xs text-ink-faint">
                        {a.org_type.replace("_", " ")} · {a.relationship.replace("_", " ")}
                      </span>
                    </span>
                    <span className={`text-xs ${a.verified ? "text-forest-deep" : "text-ink-faint"}`}>
                      {a.verified ? "verified" : "unverified"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(s.matches?.length ?? 0) > 0 && (
            <div className="border border-line bg-surface p-5">
              <h2 className="text-sm font-semibold text-ink">Matches</h2>
              <ul className="mt-2 space-y-1.5">
                {s.matches!.map((m: { id: string; final_score: number; similarity: number; status: string; problems: { id: string; title: string } | { id: string; title: string }[] }) => {
                  const problem = Array.isArray(m.problems) ? m.problems[0] : m.problems;
                  return (
                    <li key={m.id} className="flex items-center justify-between gap-3 text-sm">
                      <Link
                        href={`/dashboard/problems/${problem?.id}`}
                        className="truncate text-ink underline-offset-2 hover:underline"
                      >
                        {problem?.title}
                      </Link>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="font-mono text-xs tabular-nums text-ink-secondary">
                          {m.final_score} · sim {m.similarity.toFixed(2)}
                        </span>
                        <StatusChip status={m.status} />
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        <aside className="space-y-6">
          <div className="border border-line bg-surface p-5">
            <div className="flex items-baseline justify-between">
              <span className="text-xs uppercase tracking-wider text-ink-secondary">
                Base readiness
              </span>
              <ConfidenceChip level={p?.data_confidence ?? null} />
            </div>
            <div className="mt-1"><BigScore value={p?.base_readiness ?? null} /></div>
            <p className="mt-1 text-xs text-ink-faint">
              Confidence is displayed, never blended into the score.
            </p>
          </div>

          <div className="border border-line bg-surface p-5">
            {fact("PoC status", p?.poc_status?.replace(/_/g, " "), "poc_status")}
            {fact("Infrastructure", p?.infra_intensity?.replace(/_/g, " "), "infra_intensity")}
            {fact("Gov experience", p?.gov_experience === null ? "unknown" : p?.gov_experience ? "yes" : "no (confirmed)", "gov_experience")}
            {fact("Funding (USD)", p?.funding_raised_usd == null ? "unknown" : Number(p.funding_raised_usd).toLocaleString(), "funding_raised_usd")}
            {fact("Team size", p?.team_size, "team_size")}
            {fact("Stage", p?.stage?.replace(/_/g, " "), "stage")}
            {fact("HQ", p?.hq_country ? countryNames([p.hq_country])[0] : null, "hq_country")}
            {fact("Active in", p?.countries_active?.length ? countryNames(p.countries_active).join(", ") : null, "countries_active")}
            {fact("Sectors", p?.sectors?.join(", "), "sectors")}
            {fact("SDGs", p?.sdg_tags?.join(", "), "sdg_tags")}
          </div>

          {s.contact_email && (
            <div className="border border-line bg-surface p-5 text-sm">
              <p className="text-xs uppercase tracking-wider text-ink-secondary">Contact</p>
              <p className="mt-1 text-ink">{s.contact_name ?? "—"}</p>
              <p className="text-ink-secondary">{s.contact_email}</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
