"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { sourceExternally, sourcingStatus } from "./ask-actions";

/**
 * Trigger and progress for the external hunt, shared by the Ask screen
 * and the problem page.
 *
 * The important part is the worker nudge. Queueing a job is not the same
 * as running one: on a serverless host nothing drains the queue between
 * scheduled sweeps, so a button that only enqueues looks broken. This
 * kicks the worker on trigger and keeps kicking while the job is still
 * waiting — one dropped tick must not strand a hunt.
 */
export function SourcingPanel({
  problemId,
  autoStarted = false,
}: {
  problemId: string;
  /** True when the Ask already queued a run, so we poll immediately. */
  autoStarted?: boolean;
}) {
  const [running, setRunning] = useState(autoStarted);
  const [status, setStatus] = useState<{
    status: string;
    candidatesFound: number | null;
    inQueue: number;
    jobsAhead: number;
    profiling: number;
  } | null>(null);
  const [gaveUp, setGaveUp] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }, []);

  const watch = useCallback(() => {
    const startedAt = Date.now();
    const kick = () => fetch("/api/worker/tick", { method: "POST" }).catch(() => {});
    kick();

    stop();
    timer.current = setInterval(async () => {
      let s;
      try {
        s = await sourcingStatus(problemId);
      } catch {
        return; // transient — keep watching
      }
      setStatus(s);

      if (s.status === "completed" || s.status === "failed") {
        setRunning(false);
        // The hunt is done, but the candidates it found are still being
        // profiled in the background. Keep nudging the worker so those
        // finish while the officer reads, then stop.
        if (s.profiling > 0 && Date.now() - startedAt < 6 * 60_000) {
          kick();
          return;
        }
        stop();
        return;
      }
      if (s.status === "queued") kick();
      if (Date.now() - startedAt > 4 * 60_000) {
        stop();
        setGaveUp(true);
        setRunning(false);
      }
    }, 5000);
  }, [problemId, stop]);

  useEffect(() => {
    if (autoStarted) watch();
    return stop;
  }, [autoStarted, watch, stop]);

  async function trigger() {
    setGaveUp(false);
    setStatus(null);
    setRunning(true);
    try {
      await sourceExternally(problemId);
      watch();
    } catch {
      setRunning(false);
      setGaveUp(true);
    }
  }

  const done = status?.status === "completed";
  const failed = status?.status === "failed";

  if (done) {
    return (
      <div className="mt-5 text-sm text-forest-deep">
        Hunt complete — {status?.candidatesFound ?? 0} new candidate
        {status?.candidatesFound === 1 ? "" : "s"} added to the review queue for
        vetting.{" "}
        <Link href="/dashboard/queue" className="underline underline-offset-2">
          Review them →
        </Link>
        {(status?.profiling ?? 0) > 0 && (
          <span className="mt-1 block text-xs text-ink-faint">
            Filling in their profiles in the background — you can review them
            now; details will appear as they land.
          </span>
        )}
      </div>
    );
  }

  if (running) {
    const ahead = status?.jobsAhead ?? 0;
    return (
      <div className="mx-auto mt-5 max-w-md">
        <div className="flex items-center justify-center gap-2 text-sm text-forest-deep">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-forest" />
          {status === null
            ? "Starting the search…"
            : ahead > 0
              ? `Queued — ${ahead} job${ahead === 1 ? "" : "s"} ahead of this one.`
              : "Searching the open web — four queries, running now."}
        </div>
        <div className="mt-4 space-y-2">
          <div className="shimmer h-3.5 w-full rounded" />
          <div className="shimmer h-3.5 w-4/5 rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="mt-5">
      <button
        onClick={trigger}
        className="bg-forest px-5 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-forest-deep"
      >
        {gaveUp || failed ? "Try the hunt again" : "Source externally"}
      </button>
      {(gaveUp || failed) && (
        <p className="mt-2 text-xs text-err">
          {gaveUp
            ? "That run is taking unusually long — it may still finish in the background."
            : "The last hunt failed."}
        </p>
      )}
      {(status?.inQueue ?? 0) > 0 && (
        <p className="mt-2 text-xs text-ink-faint">
          {status!.inQueue} candidate{status!.inQueue > 1 ? "s" : ""} already
          sourced for this problem —{" "}
          <Link href="/dashboard/queue" className="underline underline-offset-2">
            see the review queue
          </Link>
          .
        </p>
      )}
    </div>
  );
}
