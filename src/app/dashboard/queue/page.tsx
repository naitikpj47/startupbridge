import Link from "next/link";
import { requireOfficer } from "@/lib/server/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { approveStartup, rejectStartup, markClaimed } from "../actions";
import { ConfidenceChip, StatusChip, FlagList, PageTitle, EmptyState } from "../bits";
import type { ReviewFlag } from "@/lib/provenance";

export const dynamic = "force-dynamic";

/**
 * Review queue: everything submitted or under review, with provenance
 * conflicts and verify-flags surfaced. Sortable by relevance to any
 * open problem (uses the similarity RPC — service role).
 */
export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<{ relevance?: string }>;
}) {
  const { sb } = await requireOfficer();
  const { relevance } = await searchParams;

  const { data: openProblems } = await sb
    .from("problems")
    .select("id, title")
    .in("status", ["open", "matching"])
    .order("created_at");

  const { data: startups, error } = await sb
    .from("startups")
    .select(
      "id, name, domain, source, status, claimed, sourced_for, review_flags, created_at, " +
        "startup_profiles(base_readiness, data_confidence, sectors, hq_country, poc_status, infra_intensity), " +
        "problems:sourced_for(title)"
    )
    .in("status", ["submitted", "under_review"])
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  // Concatenated select strings defeat supabase-js's literal type parser.
  const startupRows = (startups ?? []) as unknown as {
    id: string;
    name: string;
    domain: string | null;
    source: string;
    status: string;
    claimed: boolean;
    sourced_for: string | null;
    review_flags: unknown;
    startup_profiles: Record<string, never> | Record<string, never>[] | null;
    problems: { title: string } | { title: string }[] | null;
  }[];

  // Optional relevance sort against a chosen open problem.
  let simByStartup: Map<string, number> | null = null;
  if (relevance) {
    const admin = createSupabaseAdminClient();
    const { data: sims } = await admin.rpc("problem_similarities", {
      p_problem_id: relevance,
    });
    if (sims) {
      simByStartup = new Map(
        (sims as { startup_id: string; similarity: number }[]).map((s) => [
          s.startup_id,
          s.similarity,
        ])
      );
    }
  }

  const rows = [...startupRows];
  if (simByStartup) {
    rows.sort(
      (a, b) => (simByStartup.get(b.id) ?? -1) - (simByStartup.get(a.id) ?? -1)
    );
  }

  return (
    <div>
      <PageTitle
        title="Review queue"
        sub="Approve into the matching pool, or reject — rejections never resurface."
      />

      {(openProblems?.length ?? 0) > 0 && (
        <form className="mt-6 flex items-center gap-2 text-sm" method="get">
          <label className="text-xs uppercase tracking-wider text-ink-secondary">
            Sort by relevance to
          </label>
          <select
            name="relevance"
            defaultValue={relevance ?? ""}
            className="border border-line bg-surface px-2 py-1 text-sm"
          >
            <option value="">— submission date —</option>
            {openProblems!.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title.slice(0, 60)}
              </option>
            ))}
          </select>
          <button className="border border-line px-2.5 py-1 text-xs text-ink-secondary hover:bg-well">
            Apply
          </button>
        </form>
      )}

      <div className="mt-6 space-y-4">
        {rows.length === 0 && (
          <EmptyState
            title="Queue is clear."
            body="New self-serve submissions, scraped discoveries, and CSV imports land here for review."
          />
        )}
        {rows.map((s) => {
          const profile = (Array.isArray(s.startup_profiles)
            ? s.startup_profiles[0]
            : s.startup_profiles) as {
            base_readiness: number | null;
            data_confidence: string | null;
            sectors: string[] | null;
            hq_country: string | null;
            poc_status: string | null;
            infra_intensity: string | null;
          } | null;
          const sourcedFor = Array.isArray(s.problems) ? s.problems[0] : s.problems;
          const flags = (s.review_flags ?? []) as ReviewFlag[];
          const sim = simByStartup?.get(s.id);
          return (
            <div key={s.id} className="animate-rise border border-line bg-surface p-5">
              <div className="flex items-start justify-between gap-6">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/dashboard/startups/${s.id}`}
                      className="text-sm font-semibold text-ink underline-offset-2 hover:underline"
                    >
                      {s.name}
                    </Link>
                    <StatusChip status={s.status} />
                    <span className="text-xs text-ink-faint">{s.source.replace("_", " ")}</span>
                    {s.claimed && <span className="text-xs text-forest-deep">claimed</span>}
                    {sim !== undefined && (
                      <span className="font-mono text-xs tabular-nums text-ink-secondary">
                        sim {sim.toFixed(3)}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-ink-secondary">
                    {s.domain ?? "no domain"}
                    {profile?.sectors?.length ? ` · ${profile.sectors.join(", ")}` : ""}
                    {profile?.hq_country ? ` · HQ ${profile.hq_country}` : ""}
                    {sourcedFor ? ` · sourced for: ${sourcedFor.title.slice(0, 50)}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-ink-faint">
                    PoC: {profile?.poc_status ?? "unknown"} · infra:{" "}
                    {profile?.infra_intensity ?? "unknown"} · readiness:{" "}
                    <span className="font-mono tabular-nums">
                      {profile?.base_readiness ?? "—"}
                    </span>{" "}
                    <ConfidenceChip level={profile?.data_confidence ?? null} />
                  </p>
                  <FlagList flags={flags} />
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <form action={approveStartup.bind(null, s.id)}>
                    <button className="bg-forest px-3.5 py-1.5 text-xs font-medium text-white transition-colors duration-150 hover:bg-forest-deep">
                      Approve
                    </button>
                  </form>
                  <form action={rejectStartup.bind(null, s.id)}>
                    <button className="border border-line px-3.5 py-1.5 text-xs text-ink-secondary transition-colors duration-150 hover:border-err hover:text-err">
                      Reject
                    </button>
                  </form>
                  {!s.claimed && (
                    <form action={markClaimed.bind(null, s.id)}>
                      <button className="text-xs text-ink-faint underline-offset-2 hover:text-ink hover:underline">
                        Mark claimed
                      </button>
                    </form>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
