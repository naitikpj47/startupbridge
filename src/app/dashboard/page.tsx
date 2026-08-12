import Link from "next/link";
import { requireOfficer } from "@/lib/server/auth";
import { PageTitle } from "./bits";

export default async function Overview() {
  const { sb } = await requireOfficer();

  const count = async (table: string, filter?: (q: any) => any) => {
    let q = sb.from(table).select("*", { count: "exact", head: true });
    if (filter) q = filter(q);
    const { count: c } = await q;
    return c ?? 0;
  };

  const [pending, approved, openProblems, strongMatches, shortlisted] =
    await Promise.all([
      count("startups", (q) => q.in("status", ["submitted", "under_review"])),
      count("startups", (q) => q.eq("status", "approved")),
      count("problems", (q) => q.in("status", ["open", "matching"])),
      count("matches", (q) => q.gte("similarity", 0.5)),
      count("matches", (q) => q.neq("status", "suggested")),
    ]);

  const { data: lastRun } = await sb
    .from("scrape_runs")
    .select("started_at, new_found, updated, failed")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const tiles = [
    { label: "Awaiting review", value: pending, href: "/dashboard/queue" },
    { label: "Approved pool", value: approved, href: "/dashboard/startups" },
    { label: "Open problems", value: openProblems, href: "/dashboard/problems" },
    { label: "Strong matches", value: strongMatches, href: "/dashboard/problems" },
    { label: "In pipeline", value: shortlisted, href: "/dashboard/problems" },
  ];

  return (
    <div>
      <PageTitle title="Overview" sub="The state of the pool at a glance." />

      <div className="mt-8 grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-5">
        {tiles.map((tile) => (
          <Link
            key={tile.label}
            href={tile.href}
            className="group bg-paper px-4 py-5 transition-colors duration-150 hover:bg-surface"
          >
            <p className="font-mono text-3xl tabular-nums tracking-tight text-ink">
              {tile.value}
            </p>
            <p className="mt-1 text-xs uppercase tracking-wider text-ink-secondary group-hover:text-ink">
              {tile.label}
            </p>
          </Link>
        ))}
      </div>

      <div className="mt-10 border border-line bg-surface p-6">
        <h2 className="text-sm font-semibold text-ink">Last night's harvest</h2>
        {lastRun ? (
          <p className="mt-2 text-sm text-ink-secondary">
            {new Date(lastRun.started_at).toLocaleString()} —{" "}
            <span className="font-mono tabular-nums">{lastRun.new_found}</span> new,{" "}
            <span className="font-mono tabular-nums">{lastRun.updated}</span> refreshed,{" "}
            <span className="font-mono tabular-nums">{lastRun.failed}</span> failed.
          </p>
        ) : (
          <p className="mt-2 text-sm leading-relaxed text-ink-secondary">
            No scraper runs yet — nightly discovery arrives with Phase 6.
            When it's live, this reads "X new, Y refreshed, Z failed,
            N pending review."
          </p>
        )}
      </div>
    </div>
  );
}
