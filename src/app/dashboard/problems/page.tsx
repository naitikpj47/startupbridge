import Link from "next/link";
import { requireOfficer } from "@/lib/server/auth";
import { createProblem } from "../actions";
import { StatusChip, PageTitle } from "../bits";

export const dynamic = "force-dynamic";

export default async function ProblemsPage() {
  const { sb } = await requireOfficer();

  const { data: problems, error } = await sb
    .from("problems")
    .select("id, title, country, sector, status, created_at, matches(id)")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  const inputCls =
    "w-full border border-line bg-surface px-3 py-2 text-sm placeholder:text-ink-faint focus:border-forest focus:outline-none";

  return (
    <div>
      <PageTitle
        title="Problems"
        sub="Post a problem statement; Claude drafts the brief; you confirm before matching opens."
      />

      <div className="mt-8 border border-line bg-surface p-5">
        <h2 className="text-sm font-semibold text-ink">New problem statement</h2>
        <form action={createProblem} className="mt-4 space-y-3">
          <input name="title" required placeholder="Title" className={inputCls} />
          <div className="grid grid-cols-3 gap-3">
            <input name="country" placeholder="Country (ISO, e.g. PH)" maxLength={2} className={inputCls} />
            <input name="sector" placeholder="Sector (e.g. health)" className={inputCls} />
            <input name="sdg_tags" placeholder="SDGs (e.g. SDG3, SDG13)" className={inputCls} />
          </div>
          <textarea
            name="description"
            placeholder="What's the problem, who has it, what constraints matter?"
            className={`${inputCls} min-h-24`}
          />
          <button className="bg-forest px-4 py-2 text-xs font-medium text-white transition-colors duration-150 hover:bg-forest-deep">
            Create draft — Claude will draft the brief
          </button>
        </form>
      </div>

      <div className="mt-8 space-y-3">
        {(problems ?? []).map((p) => (
          <Link
            key={p.id}
            href={`/dashboard/problems/${p.id}`}
            className="flex items-center justify-between gap-4 border border-line bg-surface p-4 transition-colors duration-150 hover:bg-well"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink">{p.title}</p>
              <p className="mt-0.5 text-xs text-ink-secondary">
                {[p.country, p.sector].filter(Boolean).join(" · ") || "—"}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="font-mono text-xs tabular-nums text-ink-secondary">
                {p.matches?.length ?? 0} scored
              </span>
              <StatusChip status={p.status} />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
