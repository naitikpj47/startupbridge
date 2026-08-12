"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MatchRow } from "@/lib/matching/engine";
import { setMatchStatus, regenerateBriefing, addOutreach } from "../../actions";
import { ConfidenceChip, StatusChip } from "../../bits";

export interface MatchDisplay extends MatchRow {
  startupPageId: string;
  rationale: string | null;
  briefing_note: string | null;
  briefing_generated_at: string | null;
  briefingStale: boolean;
  verifyFlags: string[];
  outreach: {
    id: string;
    contacted_at: string;
    channel: string | null;
    response_status: string;
    notes: string | null;
  }[];
}

const MATCH_STATUSES = ["suggested", "shortlisted", "introduced", "engaged", "dropped"];

/** Kick the worker (briefing jobs) and refresh the page a few times so
 * the generated note appears without manual reloading. */
function useBackgroundRefresh() {
  const router = useRouter();
  return () => {
    fetch("/api/worker/tick", { method: "POST" }).catch(() => {});
    [8000, 20000, 40000].forEach((ms) => setTimeout(() => router.refresh(), ms));
  };
}

export function MatchList({
  matches,
  adjacent,
  threshold,
}: {
  matches: MatchDisplay[];
  adjacent: MatchDisplay[];
  threshold: number;
}) {
  return (
    <div className="space-y-3">
      {matches.map((m) => (
        <MatchCard key={m.id} match={m} adjacent={false} />
      ))}
      {adjacent.length > 0 && (
        <>
          <p className="pt-2 text-xs uppercase tracking-wider text-ink-faint">
            Adjacent — below the {threshold.toFixed(2)} similarity bar
          </p>
          {adjacent.map((m) => (
            <MatchCard key={m.id} match={m} adjacent />
          ))}
        </>
      )}
    </div>
  );
}

function MatchCard({ match, adjacent }: { match: MatchDisplay; adjacent: boolean }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [generating, setGenerating] = useState(false);
  const kickWorker = useBackgroundRefresh();
  const router = useRouter();

  const changeStatus = (status: string) => {
    startTransition(async () => {
      await setMatchStatus(match.id, status);
      if (status === "shortlisted" && !match.briefing_note) {
        setGenerating(true);
        kickWorker();
      }
      router.refresh();
    });
  };

  const regenerate = () => {
    startTransition(async () => {
      await regenerateBriefing(match.id);
      setGenerating(true);
      kickWorker();
    });
  };

  return (
    <div
      className={`border bg-surface transition-colors duration-150 ${
        adjacent ? "border-line opacity-80" : "border-line"
      }`}
    >
      <div className="flex items-center gap-4 p-4">
        {/* Score with breakdown on hover */}
        <div className="group relative shrink-0 cursor-default">
          <span className="font-mono text-2xl tabular-nums tracking-tight text-ink">
            {match.final_score}
          </span>
          <div className="invisible absolute left-0 top-full z-10 mt-1 w-52 border border-line bg-surface p-3 text-xs shadow-none group-hover:visible">
            {[
              ["Similarity", `${(match.similarity * 100).toFixed(0)}`],
              ["Readiness", match.base_readiness ?? "unknown"],
              ["Context fit", match.context_fit ?? "unknown"],
              ["Partnership priority", match.strategic_fit],
            ].map(([label, value]) => (
              <div key={String(label)} className="flex justify-between py-0.5">
                <span className="text-ink-secondary">{label}</span>
                <span className="font-mono tabular-nums text-ink">{value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/dashboard/startups/${match.startupPageId}`}
              className="text-sm font-semibold text-ink underline-offset-2 hover:underline"
            >
              {match.name}
            </Link>
            <ConfidenceChip level={match.data_confidence} />
            {adjacent && (
              <span className="rounded bg-well px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                adjacent
              </span>
            )}
          </div>
          <p className="mt-0.5 font-mono text-xs tabular-nums text-ink-faint">
            sim {match.similarity.toFixed(3)}
          </p>
          {match.verifyFlags.length > 0 && (
            <p className="mt-1 text-xs text-warn">
              Verify before intro: {match.verifyFlags.length} open item
              {match.verifyFlags.length > 1 ? "s" : ""}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <select
            value={match.status}
            disabled={pending}
            onChange={(e) => changeStatus(e.target.value)}
            className="border border-line bg-surface px-2 py-1 text-xs"
          >
            {MATCH_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <button
            onClick={() => setOpen(!open)}
            className="border border-line px-2.5 py-1 text-xs text-ink-secondary hover:bg-well"
          >
            {open ? "Less" : "More"}
          </button>
        </div>
      </div>

      {open && (
        <div className="space-y-4 border-t border-line p-4">
          {match.verifyFlags.length > 0 && (
            <ul className="space-y-1">
              {match.verifyFlags.map((flag, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs text-warn">
                  <span className="mt-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />
                  {flag}
                </li>
              ))}
            </ul>
          )}

          <div>
            <p className="text-xs uppercase tracking-wider text-ink-secondary">Rationale</p>
            {match.rationale ? (
              <p className="mt-1 text-sm leading-relaxed text-ink">{match.rationale}</p>
            ) : generating ? (
              <div className="mt-2 space-y-1.5">
                <div className="shimmer h-3.5 w-full" />
                <div className="shimmer h-3.5 w-4/5" />
              </div>
            ) : (
              <p className="mt-1 text-sm text-ink-faint">
                Generated when the match is shortlisted.
              </p>
            )}
          </div>

          <div>
            <div className="flex items-center gap-3">
              <p className="text-xs uppercase tracking-wider text-ink-secondary">
                Briefing note
              </p>
              {match.briefing_generated_at && (
                <span className="text-[11px] text-ink-faint">
                  generated {new Date(match.briefing_generated_at).toLocaleString()}
                </span>
              )}
              {match.briefingStale && (
                <button
                  onClick={regenerate}
                  disabled={pending}
                  className="text-[11px] text-warn underline underline-offset-2"
                >
                  Profile changed since — regenerate
                </button>
              )}
              {match.briefing_note && !match.briefingStale && (
                <button
                  onClick={regenerate}
                  disabled={pending}
                  className="text-[11px] text-ink-faint underline underline-offset-2 hover:text-ink"
                >
                  Regenerate
                </button>
              )}
            </div>
            {match.briefing_note ? (
              <div className="mt-2 max-h-80 overflow-y-auto whitespace-pre-line border border-line bg-paper p-4 text-sm leading-relaxed text-ink">
                {match.briefing_note}
              </div>
            ) : generating ? (
              <div className="mt-2 space-y-1.5">
                <div className="shimmer h-3.5 w-full" />
                <div className="shimmer h-3.5 w-5/6" />
                <div className="shimmer h-3.5 w-2/3" />
              </div>
            ) : (
              <p className="mt-1 text-sm text-ink-faint">
                Generated with the rationale on shortlist.
              </p>
            )}
          </div>

          <div>
            <p className="text-xs uppercase tracking-wider text-ink-secondary">
              Outreach log
            </p>
            {match.outreach.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {match.outreach.map((o) => (
                  <li key={o.id} className="flex items-baseline gap-3 text-sm">
                    <span className="shrink-0 font-mono text-xs tabular-nums text-ink-faint">
                      {new Date(o.contacted_at).toLocaleDateString()}
                    </span>
                    <span className="text-ink">{o.channel ?? "—"}</span>
                    <StatusChip status={o.response_status} />
                    {o.notes && <span className="text-xs text-ink-secondary">{o.notes}</span>}
                  </li>
                ))}
              </ul>
            )}
            <form
              action={async (formData: FormData) => {
                await addOutreach(match.id, formData);
                router.refresh();
              }}
              className="mt-2 flex items-center gap-2"
            >
              <select name="channel" className="border border-line bg-surface px-2 py-1 text-xs">
                {["email", "call", "intro_meeting", "other"].map((c) => (
                  <option key={c} value={c}>{c.replace("_", " ")}</option>
                ))}
              </select>
              <select name="response_status" className="border border-line bg-surface px-2 py-1 text-xs">
                {["pending", "interested", "declined"].map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
              <input
                name="notes"
                placeholder="Notes"
                className="flex-1 border border-line bg-surface px-2 py-1 text-xs placeholder:text-ink-faint focus:border-forest focus:outline-none"
              />
              <button className="border border-line px-2.5 py-1 text-xs text-ink-secondary hover:bg-well">
                Log
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
