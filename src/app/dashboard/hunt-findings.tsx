"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  huntFindings,
  analyseCandidates,
  acceptCandidate,
  dismissCandidate,
  type Finding,
} from "./sourcing-actions";
import { ConfidenceChip } from "./bits";
import { Tick } from "./dimension-icons";

/**
 * What the hunt found, on the problem it was run for.
 *
 * The previous version handed the officer a link to the global review
 * queue — every submission, import and past hunt in one undifferentiated
 * list — and left them to work out which six rows were theirs. These are
 * theirs: shown here, with the evidence that got each one picked, and a
 * checkbox so the officer decides who is worth the deep analysis before
 * a single model call is spent on them.
 */
export function HuntFindings({
  problemId,
  /** Poll on mount — a hunt just finished and rows are still landing. */
  live = false,
}: {
  problemId: string;
  live?: boolean;
}) {
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [threshold, setThreshold] = useState(0.5);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }, []);

  /**
   * Returns the number still being analysed, or null if the call itself
   * failed. The distinction matters: a transient failure read as "zero
   * left" would stop the poller AND the worker nudges that make queued
   * jobs actually run, stranding every row on its spinner until a
   * reload.
   */
  const load = useCallback(async (): Promise<number | null> => {
    try {
      const view = await huntFindings(problemId);
      setFindings(view.findings);
      setThreshold(view.threshold);
      setError(null);
      // Drop anything no longer offerable — a candidate dismissed or
      // already analysed must leave the selection, or the next click
      // pays for a company the officer just rejected.
      const selectable = new Set(
        view.findings.filter((f) => !f.analysed && !f.pending).map((f) => f.id)
      );
      setPicked((p) => {
        const next = new Set([...p].filter((id) => selectable.has(id)));
        return next.size === p.size ? p : next;
      });
      return view.analysing;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the findings.");
      return null;
    }
  }, [problemId]);

  /** Poll while analysis is in flight. Transient failures keep watching. */
  const watch = useCallback(() => {
    stop();
    const startedAt = Date.now();
    const kick = () =>
      fetch("/api/worker/tick", { method: "POST" }).catch(() => {});
    kick();
    timer.current = setInterval(async () => {
      const analysing = await load();
      if (Date.now() - startedAt > 5 * 60_000) {
        stop();
        return;
      }
      if (analysing === 0) {
        stop();
        return;
      }
      kick(); // covers analysing === null: keep nudging, keep watching
    }, 4000);
  }, [load, stop]);

  useEffect(() => {
    load().then((analysing) => {
      if ((analysing ?? 0) > 0 || live) watch();
    });
    return stop;
  }, [load, watch, stop, live]);

  async function runAnalysis() {
    setError(null);
    setBusy(true);
    try {
      const { queued } = await analyseCandidates(problemId, [...picked]);
      if (queued === 0) setError("Those are already being analysed.");
      setPicked(new Set());
      await load();
      watch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the analysis.");
    } finally {
      setBusy(false);
    }
  }

  async function act(fn: (p: string, s: string) => Promise<void>, id: string) {
    setError(null);
    try {
      await fn(problemId, id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work.");
    }
  }

  // Error before the loading check, not after it: a first load that
  // throws leaves findings null forever, and an error banner placed
  // below this early return can never be reached.
  if (error && findings === null) {
    return (
      <div className="mt-5 border-l-2 border-err bg-err-tint px-4 py-3">
        <p className="text-sm text-err">Couldn&apos;t load what the hunt found.</p>
        <p className="mt-1 text-xs text-ink-secondary">{error}</p>
        <button
          onClick={() => {
            setError(null);
            load();
          }}
          className="mt-2 text-sm text-forest underline underline-offset-2"
        >
          Try again
        </button>
      </div>
    );
  }

  if (findings === null) {
    return (
      <div className="mt-5 space-y-2">
        <div className="shimmer h-14 w-full rounded" />
        <div className="shimmer h-14 w-full rounded" />
      </div>
    );
  }
  if (findings.length === 0) return null;

  const unanalysed = findings.filter((f) => !f.analysed && !f.pending);
  const allPicked = unanalysed.length > 0 && picked.size === unanalysed.length;

  return (
    <div className="mt-6 text-left">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-ink">
          {findings.length} candidate{findings.length === 1 ? "" : "s"} found for
          this problem
        </h3>
        {unanalysed.length > 0 && (
          <button
            onClick={() =>
              setPicked(allPicked ? new Set() : new Set(unanalysed.map((f) => f.id)))
            }
            className="text-xs text-forest underline-offset-2 hover:underline"
          >
            {allPicked ? "Clear selection" : `Select all ${unanalysed.length}`}
          </button>
        )}
      </div>
      <p className="mt-1 max-w-2xl text-xs leading-relaxed text-ink-secondary">
        Each one was picked for the evidence below. Choose who's worth a deep
        analysis — we'll read their site, score their readiness and measure how
        closely they actually fit this problem. Nothing is scored until you say
        so.
      </p>

      <ul className="mt-4 space-y-2">
        {findings.map((f) => (
          <FindingRow
            key={f.id}
            finding={f}
            threshold={threshold}
            picked={picked.has(f.id)}
            onToggle={() =>
              setPicked((p) => {
                const next = new Set(p);
                next.has(f.id) ? next.delete(f.id) : next.add(f.id);
                return next;
              })
            }
            onAccept={() => act(acceptCandidate, f.id)}
            onDismiss={() => act(dismissCandidate, f.id)}
          />
        ))}
      </ul>

      {error && (
        <p className="mt-3 border-l-2 border-err bg-err-tint px-3 py-2 text-sm text-err">
          {error}
        </p>
      )}

      {picked.size > 0 && (
        <div className="sticky bottom-4 mt-4 flex flex-wrap items-center gap-3 border border-forest bg-surface px-4 py-3">
          <button
            onClick={runAnalysis}
            disabled={busy}
            className="bg-forest px-5 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-forest-deep disabled:opacity-50"
          >
            {busy
              ? "Starting…"
              : `Run deep analysis on ${picked.size} selected`}
          </button>
          <span className="text-xs text-ink-secondary">
            One site fetch and one model call each — roughly a cent per
            candidate.
          </span>
        </div>
      )}
    </div>
  );
}

function FindingRow({
  finding: f,
  threshold,
  picked,
  onToggle,
  onAccept,
  onDismiss,
}: {
  finding: Finding;
  threshold: number;
  picked: boolean;
  onToggle: () => void;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const selectable = !f.analysed && !f.pending;
  const clears = f.similarity != null && f.similarity >= threshold;

  return (
    <li
      className={`animate-rise border bg-surface p-4 transition-colors duration-150 ${
        picked ? "border-forest" : "border-line"
      }`}
    >
      <div className="flex items-start gap-3">
        {selectable && (
          <button
            onClick={onToggle}
            role="checkbox"
            aria-checked={picked}
            aria-label={`Select ${f.name} for analysis`}
            className={`mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center border transition-colors duration-150 ${
              picked
                ? "border-forest bg-forest text-white"
                : "border-line-strong bg-surface hover:border-forest"
            }`}
          >
            {picked && <Tick className="h-2.5 w-2.5" />}
          </button>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/dashboard/startups/${f.id}`}
              className="text-sm font-semibold text-ink underline-offset-2 hover:underline"
            >
              {f.name}
            </Link>
            {f.website && (
              <a
                href={f.website}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="text-xs text-ink-faint underline-offset-2 hover:text-forest hover:underline"
              >
                {f.domain ?? "site"} ↗
              </a>
            )}
            {f.hqCountry && (
              <span className="text-xs text-ink-faint">HQ {f.hqCountry}</span>
            )}
            {f.status === "approved" && (
              <span className="text-xs font-medium text-forest">in the pool</span>
            )}
          </div>

          {f.evidence && (
            <p className="mt-1.5 border-l-2 border-line-strong pl-2.5 text-xs leading-relaxed text-ink-secondary">
              {f.evidence}
            </p>
          )}

          {f.pending && (
            <p className="mt-2 flex items-center gap-2 text-xs text-forest-deep">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-forest" />
              Reading their site and scoring them…
            </p>
          )}

          {/* A candidate whose site can't be reached must say so. Left
              silent, the row simply reverts to an unticked checkbox and
              the officer re-pays to watch nothing happen again. */}
          {f.failed && (
            <p className="mt-2 text-xs text-warn">
              Couldn&apos;t analyse this one —{" "}
              {f.failed.toLowerCase().includes("fetch")
                ? "their site didn't respond."
                : f.failed}{" "}
              You can still open it and judge from the evidence above.
            </p>
          )}

          {f.analysed && (
            <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs tabular-nums text-ink-secondary">
              <span className={clears ? "text-forest-deep" : undefined}>
                fit {f.similarity?.toFixed(3) ?? "—"}
                <span className="text-ink-faint"> / bar {threshold.toFixed(2)}</span>
              </span>
              <span>readiness {f.readiness ?? "—"}</span>
              {f.pocStatus && <span className="font-sans">PoC: {f.pocStatus}</span>}
              {f.infraIntensity && (
                <span className="font-sans">infra: {f.infraIntensity}</span>
              )}
              <ConfidenceChip level={f.confidence} />
            </div>
          )}

          {f.analysed && f.sectors?.length ? (
            <p className="mt-1 text-xs text-ink-faint">{f.sectors.join(", ")}</p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {f.analysed && f.status !== "approved" && (
            <button
              onClick={onAccept}
              className="bg-forest px-3 py-1.5 text-xs font-medium text-white transition-colors duration-150 hover:bg-forest-deep"
            >
              Add to pool
            </button>
          )}
          {f.status !== "approved" && (
            <button
              onClick={onDismiss}
              className="text-xs text-ink-faint underline-offset-2 hover:text-err hover:underline"
            >
              Not relevant
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
