import { notFound } from "next/navigation";
import { requireOfficer } from "@/lib/server/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { rankedMatches, type MatchRow } from "@/lib/matching/engine";
import { saveBrief, closeProblem, runMatchingForProblem } from "../../actions";
import { SourcingPanel } from "../../sourcing-panel";
import { StatusChip, PageTitle, EmptyState } from "../../bits";
import { MatchList, type MatchDisplay } from "./matches-client";

export const dynamic = "force-dynamic";

export default async function ProblemDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { sb } = await requireOfficer();
  const { id } = await params;

  const { data: problem } = await sb
    .from("problems")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!problem) notFound();

  // Ranked, gate-filtered view (service role: the similarity config +
  // gate live behind it). Enrich rows with briefing/outreach data.
  let ranked: { matches: MatchRow[]; adjacent: MatchRow[]; threshold: number } = {
    matches: [],
    adjacent: [],
    threshold: 0.5,
  };
  const admin = createSupabaseAdminClient();
  const hasEmbedding = problem.embedding !== null;
  if (hasEmbedding) {
    ranked = await rankedMatches(admin, id);
  }

  const allRows = [...ranked.matches, ...ranked.adjacent];
  const ids = allRows.map((m) => m.id);
  const { data: details } = ids.length
    ? await sb
        .from("matches")
        .select(
          "id, rationale, briefing_note, briefing_generated_at, " +
            "outreach(id, contacted_at, channel, response_status, notes), " +
            "startups(id, updated_at, review_flags, startup_profiles(updated_at))"
        )
        .in("id", ids)
    : { data: [] };
  // Concatenated select strings defeat supabase-js's literal type parser.
  const detailRows = (details ?? []) as unknown as {
    id: string;
    rationale: string | null;
    briefing_note: string | null;
    briefing_generated_at: string | null;
    outreach: {
      id: string;
      contacted_at: string;
      channel: string | null;
      response_status: string;
      notes: string | null;
    }[];
    startups:
      | { id: string; updated_at: string; review_flags: unknown; startup_profiles: { updated_at: string } | { updated_at: string }[] | null }
      | { id: string; updated_at: string; review_flags: unknown; startup_profiles: { updated_at: string } | { updated_at: string }[] | null }[]
      | null;
  }[];
  const detailById = new Map(detailRows.map((d) => [d.id, d]));

  const toDisplay = (m: MatchRow): MatchDisplay => {
    const d = detailById.get(m.id);
    const startup = d ? (Array.isArray(d.startups) ? d.startups[0] : d.startups) : null;
    const profile = startup
      ? Array.isArray(startup.startup_profiles)
        ? startup.startup_profiles[0]
        : startup.startup_profiles
      : null;
    const profileUpdated = profile?.updated_at ?? startup?.updated_at ?? null;
    const generated = d?.briefing_generated_at ?? null;
    return {
      ...m,
      startupPageId: startup?.id ?? m.startup_id,
      rationale: d?.rationale ?? null,
      briefing_note: d?.briefing_note ?? null,
      briefing_generated_at: generated,
      briefingStale:
        !!generated && !!profileUpdated && new Date(profileUpdated) > new Date(generated),
      verifyFlags: ((startup?.review_flags ?? []) as { type: string; detail: string }[])
        .filter((f) => f.type === "verify_before_intro")
        .map((f) => f.detail),
      outreach: (d?.outreach ?? []).sort(
        (a: { contacted_at: string }, b: { contacted_at: string }) =>
          new Date(b.contacted_at).getTime() - new Date(a.contacted_at).getTime()
      ),
    };
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-6">
        <PageTitle
          title={problem.title}
          sub={[problem.country, problem.sector, (problem.sdg_tags ?? []).join(" ")]
            .filter(Boolean)
            .join(" · ")}
        />
        <div className="flex items-center gap-3 pt-2">
          <StatusChip status={problem.status} />
          {["open", "matching"].includes(problem.status) && (
            <>
              <form action={runMatchingForProblem.bind(null, id)}>
                <button className="bg-forest px-3.5 py-1.5 text-xs font-medium text-white transition-colors duration-150 hover:bg-forest-deep">
                  Run matching
                </button>
              </form>
              <form action={closeProblem.bind(null, id)}>
                <button className="border border-line px-3 py-1.5 text-xs text-ink-secondary hover:bg-well">
                  Close
                </button>
              </form>
            </>
          )}
        </div>
      </div>

      {problem.description && (
        <p className="mt-6 max-w-3xl text-sm leading-relaxed text-ink-secondary">
          {problem.description}
        </p>
      )}

      {/* Gaps the officer couldn't fill stay visible for the life of the
          problem — a brief that quietly reads as complete is the failure
          mode this whole intake exists to prevent. */}
      {(problem.open_questions?.length ?? 0) > 0 && (
        <div className="mt-5 max-w-3xl border-l-2 border-warn bg-warn-tint px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-warn">
            Open questions — never filled in by the model
          </p>
          <ul className="mt-1.5 space-y-1">
            {(problem.open_questions as string[]).map((q) => (
              <li key={q} className="flex gap-2 text-sm leading-relaxed text-ink">
                <span className="text-warn">·</span>
                {q}
              </li>
            ))}
          </ul>
        </div>
      )}

      <BriefEditor
        problemId={id}
        brief={problem.enriched_brief}
        status={problem.status}
      />

      <div className="mt-12">
        <h2 className="text-sm font-semibold text-ink">Matches</h2>
        {!hasEmbedding ? (
          <div className="mt-4">
            <EmptyState
              title="Not embedded yet."
              body="The brief needs to be confirmed and embedded before matching can run — open the problem above, then run matching."
            />
          </div>
        ) : allRows.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="No matches scored yet."
              body='Press "Run matching" to score the approved pool against this problem.'
            />
          </div>
        ) : (
          <>
            {ranked.matches.length === 0 && (
              <div className="mt-4 border border-line bg-surface px-8 py-10 text-center">
                <p className="font-display text-xl text-ink">
                  No strong matches yet.
                </p>
                <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-secondary">
                  Nothing in the approved pool clears the {ranked.threshold.toFixed(2)}{" "}
                  similarity bar for this problem — that's worth knowing, and it's
                  honest. Below are the nearest adjacent candidates, clearly short
                  of the bar.
                </p>
                {/* The panel now renders the findings themselves, so the
                    officer picks from what was found for THIS problem
                    instead of being sent to the global review queue. */}
                <SourcingPanel problemId={id} />
              </div>
            )}
            <div className="mt-4">
              <MatchList
                matches={ranked.matches.map(toDisplay)}
                adjacent={ranked.adjacent.map(toDisplay)}
                threshold={ranked.threshold}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function BriefEditor({
  problemId,
  brief,
  status,
}: {
  problemId: string;
  brief: string | null;
  status: string;
}) {
  const saveDraft = saveBrief.bind(null, problemId);
  return (
    <div className="mt-8 border border-line bg-surface p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">Enriched brief</h2>
        {status === "draft" && (
          <span className="text-xs text-warn">
            {brief ? "Awaiting your confirmation" : "Claude is drafting — refresh shortly"}
          </span>
        )}
      </div>
      {!brief && status === "draft" ? (
        <div className="mt-4 space-y-2">
          <div className="shimmer h-4 w-full" />
          <div className="shimmer h-4 w-5/6" />
          <div className="shimmer h-4 w-2/3" />
        </div>
      ) : (
        <form
          action={async (formData: FormData) => {
            "use server";
            const text = String(formData.get("brief") ?? "");
            const open = formData.get("intent") === "open";
            await saveDraft(text, open);
          }}
          className="mt-4"
        >
          <textarea
            name="brief"
            defaultValue={brief ?? ""}
            className="min-h-56 w-full border border-line bg-paper px-3 py-2 font-mono text-xs leading-relaxed text-ink focus:border-forest focus:outline-none"
          />
          <div className="mt-3 flex items-center gap-3">
            <button
              name="intent"
              value="save"
              className="border border-line px-3.5 py-1.5 text-xs text-ink-secondary hover:bg-well"
            >
              Save brief
            </button>
            {status === "draft" && (
              <button
                name="intent"
                value="open"
                className="bg-forest px-3.5 py-1.5 text-xs font-medium text-white transition-colors duration-150 hover:bg-forest-deep"
              >
                Confirm brief &amp; open for matching
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
