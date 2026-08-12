import Link from "next/link";
import { requireOfficer } from "@/lib/server/auth";
import { ConfidenceChip, StatusChip, PageTitle } from "../bits";

export const dynamic = "force-dynamic";

export default async function StartupsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const { sb } = await requireOfficer();
  const { q, status } = await searchParams;

  let query = sb
    .from("startups")
    .select(
      "id, name, domain, source, status, claimed, " +
        "startup_profiles(base_readiness, data_confidence, sectors, hq_country, countries_active)"
    )
    .order("name");
  if (status && ["submitted", "under_review", "approved", "rejected"].includes(status)) {
    query = query.eq("status", status);
  }
  if (q?.trim()) {
    const term = q.trim().replace(/[%_]/g, "");
    query = query.or(`name.ilike.%${term}%,domain.ilike.%${term}%`);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  // Concatenated select strings defeat supabase-js's literal type parser.
  const startups = (data ?? []) as unknown as {
    id: string;
    name: string;
    domain: string | null;
    source: string;
    status: string;
    claimed: boolean;
    startup_profiles:
      | { base_readiness: number | null; data_confidence: string | null; sectors: string[] | null; hq_country: string | null }
      | { base_readiness: number | null; data_confidence: string | null; sectors: string[] | null; hq_country: string | null }[]
      | null;
  }[];

  return (
    <div>
      <PageTitle title="Startups" sub="The whole pool — search, filter, inspect." />

      <form className="mt-6 flex items-center gap-2" method="get">
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search name or domain"
          className="w-64 border border-line bg-surface px-3 py-1.5 text-sm placeholder:text-ink-faint focus:border-forest focus:outline-none"
        />
        <select
          name="status"
          defaultValue={status ?? ""}
          className="border border-line bg-surface px-2 py-1.5 text-sm"
        >
          <option value="">all statuses</option>
          {["submitted", "under_review", "approved", "rejected"].map((s) => (
            <option key={s} value={s}>{s.replace("_", " ")}</option>
          ))}
        </select>
        <button className="border border-line px-3 py-1.5 text-xs text-ink-secondary hover:bg-well">
          Filter
        </button>
      </form>

      <div className="mt-6 border border-line bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-ink-secondary">
              <th className="px-4 py-2.5 font-medium">Name</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Sectors</th>
              <th className="px-4 py-2.5 font-medium">HQ</th>
              <th className="px-4 py-2.5 text-right font-medium">Readiness</th>
              <th className="px-4 py-2.5 font-medium">Confidence</th>
            </tr>
          </thead>
          <tbody>
            {(startups ?? []).map((s) => {
              const p = Array.isArray(s.startup_profiles)
                ? s.startup_profiles[0]
                : s.startup_profiles;
              return (
                <tr
                  key={s.id}
                  className="border-b border-line last:border-b-0 transition-colors duration-150 hover:bg-well"
                >
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/dashboard/startups/${s.id}`}
                      className="font-medium text-ink underline-offset-2 hover:underline"
                    >
                      {s.name}
                    </Link>
                    <span className="ml-2 text-xs text-ink-faint">{s.domain}</span>
                  </td>
                  <td className="px-4 py-2.5"><StatusChip status={s.status} /></td>
                  <td className="px-4 py-2.5 text-xs text-ink-secondary">
                    {p?.sectors?.join(", ") ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-ink-secondary">
                    {p?.hq_country ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                    {p?.base_readiness ?? "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <ConfidenceChip level={p?.data_confidence ?? null} />
                  </td>
                </tr>
              );
            })}
            {(startups ?? []).length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-ink-secondary">
                  Nothing matches that filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
