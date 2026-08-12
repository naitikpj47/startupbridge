import Link from "next/link";
import { requireOfficer } from "@/lib/server/auth";
import { StatusChip, PageTitle, EmptyState } from "../bits";

export const dynamic = "force-dynamic";

/**
 * The archive: every need that has been asked, what it matched, and
 * where each one stands. Asking happens on the Ask screen — this is the
 * record of what came of it.
 */
export default async function ProblemsPage() {
  const { sb } = await requireOfficer();

  const { data: problems, error } = await sb
    .from("problems")
    .select("id, title, country, sector, status, created_at, matches(id, status, similarity)")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  const { data: config } = await sb
    .from("scoring_config")
    .select("similarity_threshold")
    .single();
  const threshold = Number(config?.similarity_threshold ?? 0.5);

  const { count: pending } = await sb
    .from("startups")
    .select("*", { count: "exact", head: true })
    .in("status", ["submitted", "under_review"]);

  const { data: lastRun } = await sb
    .from("scrape_runs")
    .select("started_at, new_found, updated, failed")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <div>
      <PageTitle
        title="Past asks"
        sub="Every need that has been put to the platform, and what came of it."
      />

      <div className="mt-8 space-y-3">
        {(problems ?? []).length === 0 && (
          <EmptyState
            title="Nothing asked yet."
            body="Head to Ask and describe a need — it lands here with whatever the platform found."
          />
        )}
        {(problems ?? []).map((p) => {
          const matches = (p.matches ?? []) as { status: string; similarity: number }[];
          const strong = matches.filter((m) => m.similarity >= threshold).length;
          const inPipeline = matches.filter((m) => m.status !== "suggested").length;
          return (
            <Link
              key={p.id}
              href={`/dashboard/problems/${p.id}`}
              className="flex items-center justify-between gap-4 border border-line bg-surface p-4 transition-colors duration-150 hover:bg-well"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{p.title}</p>
                <p className="mt-0.5 text-xs text-ink-secondary">
                  {[p.country, p.sector].filter(Boolean).join(" · ") || "scope unspecified"}
                  {" · asked "}
                  {new Date(p.created_at).toLocaleDateString()}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-4 text-xs">
                <span className={strong > 0 ? "text-forest-deep" : "text-ink-faint"}>
                  <span className="font-mono tabular-nums">{strong}</span> strong
                </span>
                {inPipeline > 0 && (
                  <span className="text-ink-secondary">
                    <span className="font-mono tabular-nums">{inPipeline}</span> in pipeline
                  </span>
                )}
                <StatusChip status={p.status} />
              </div>
            </Link>
          );
        })}
      </div>

      <div className="mt-12 border-t border-line pt-6">
        <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2 text-xs text-ink-secondary">
          <span>
            <span className="font-mono tabular-nums text-ink">{pending ?? 0}</span>{" "}
            awaiting review
          </span>
          <span>
            similarity bar{" "}
            <span className="font-mono tabular-nums text-ink">{threshold.toFixed(2)}</span>
          </span>
          <span className="text-ink-faint">
            {lastRun
              ? `last harvest ${new Date(lastRun.started_at).toLocaleDateString()}: ${lastRun.new_found} new, ${lastRun.updated} refreshed, ${lastRun.failed} failed`
              : "nightly harvest reports here once the scheduler runs"}
          </span>
        </div>
      </div>
    </div>
  );
}
