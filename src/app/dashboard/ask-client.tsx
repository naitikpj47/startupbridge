"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  askForHelp,
  sourcingStatus,
  type AskOutcome,
  type AskFailure,
  type AskResult,
} from "./ask-actions";

/** A "use server" module may only export async functions, so the type
 * guard for its result union lives here. */
function askFailed(result: AskResult): result is AskFailure {
  return "failed" in result;
}
import { ConfidenceChip } from "./bits";
import { CountUp } from "./count-up";

const EXAMPLES = [
  "I need something that helps decrease malaria in Thailand",
  "Rural clinics in Nepal keep losing vaccines to power cuts",
  "Farmers in Vietnam need earlier warning of saltwater intrusion",
];

const STEPS = [
  "Reading your ask",
  "Drafting the problem statement",
  "Searching the pool",
  "Scoring candidates",
];

export function AskBox() {
  const [ask, setAsk] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [outcome, setOutcome] = useState<AskOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 4000);
    return () => clearInterval(timer);
  }, [busy]);

  async function submit(text: string) {
    setError(null);
    setOutcome(null);
    setStep(0);
    setBusy(true);
    try {
      const result = await askForHelp(text);
      if (askFailed(result)) setError(result.message);
      else setOutcome(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (outcome) {
    return <AskResult outcome={outcome} onReset={() => { setOutcome(null); setAsk(""); }} />;
  }

  return (
    <div className="animate-rise">
      <h1 className="font-display text-4xl leading-tight tracking-tight text-ink">
        What do you need?
      </h1>
      <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-secondary">
        Describe the problem in your own words. We'll write it up, search the
        pool for field-proven startups, and go hunting externally if nothing
        measures up.
      </p>

      <div className="mt-8">
        <textarea
          value={ask}
          onChange={(e) => setAsk(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && ask.trim()) submit(ask);
          }}
          disabled={busy}
          placeholder="I need something that helps decrease malaria in Thailand…"
          className="min-h-28 w-full border border-line bg-surface px-4 py-3 text-base leading-relaxed text-ink placeholder:text-ink-faint focus:border-forest focus:outline-none disabled:opacity-60"
        />
        <div className="mt-3 flex items-center gap-4">
          <button
            onClick={() => submit(ask)}
            disabled={busy || ask.trim().length < 8}
            className="bg-forest px-6 py-2.5 text-sm font-medium text-white transition-colors duration-200 hover:bg-forest-deep disabled:opacity-50"
          >
            {busy ? "Working…" : "Find me someone"}
          </button>
          <span className="text-xs text-ink-faint">⌘/Ctrl + Enter</span>
        </div>
      </div>

      {busy && (
        <div className="mt-8 max-w-md space-y-2">
          {STEPS.map((label, i) => (
            <div key={label} className="flex items-center gap-3">
              <span
                className={`h-1.5 w-1.5 rounded-full transition-colors duration-300 ${
                  i < step ? "bg-forest" : i === step ? "bg-forest" : "bg-line-strong"
                }`}
              />
              <span className={`text-sm ${i <= step ? "text-ink" : "text-ink-faint"}`}>
                {label}
              </span>
              {i === step && <span className="shimmer h-3 flex-1 rounded" />}
            </div>
          ))}
        </div>
      )}

      {error && <p className="mt-4 text-sm text-err">{error}</p>}

      {!busy && (
        <div className="mt-10">
          <p className="text-xs uppercase tracking-wider text-ink-faint">
            Or try one of these
          </p>
          <div className="mt-2 space-y-1.5">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                onClick={() => { setAsk(example); submit(example); }}
                className="block text-left text-sm text-ink-secondary underline-offset-2 transition-colors duration-150 hover:text-forest hover:underline"
              >
                "{example}"
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AskResult({ outcome, onReset }: { outcome: AskOutcome; onReset: () => void }) {
  const hasMatches = outcome.matches.length > 0;
  return (
    <div className="animate-rise">
      <button
        onClick={onReset}
        className="text-xs text-ink-secondary underline-offset-2 hover:text-ink hover:underline"
      >
        ← Ask something else
      </button>

      <h1 className="mt-3 font-display text-3xl leading-tight tracking-tight text-ink">
        {outcome.title}
      </h1>
      <p className="mt-1.5 text-xs uppercase tracking-wider text-ink-faint">
        {[outcome.country, outcome.sector].filter(Boolean).join(" · ") || "scope unspecified"}
      </p>
      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-secondary">
        {outcome.description}
      </p>

      <div className="mt-8">
        {hasMatches ? (
          <>
            <h2 className="text-sm font-semibold text-ink">
              {outcome.matches.length} startup{outcome.matches.length > 1 ? "s" : ""} worth talking to
            </h2>
            <div className="mt-3 space-y-2">
              {outcome.matches.map((m) => (
                <ResultRow key={m.id} match={m} />
              ))}
            </div>
          </>
        ) : (
          <NoMatches outcome={outcome} />
        )}
      </div>

      <div className="mt-8 border-t border-line pt-4">
        <Link
          href={`/dashboard/problems/${outcome.problemId}`}
          className="text-sm text-forest underline underline-offset-2"
        >
          Open the full problem view — briefings, pipeline, outreach →
        </Link>
      </div>
    </div>
  );
}

function ResultRow({ match }: { match: AskOutcome["matches"][number] }) {
  return (
    <div className="flex items-center gap-4 border border-line bg-surface p-4">
      <CountUp
        value={match.finalScore}
        className="font-mono text-2xl tabular-nums tracking-tight text-ink"
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/dashboard/startups/${match.startupId}`}
            className="text-sm font-semibold text-ink underline-offset-2 hover:underline"
          >
            {match.name}
          </Link>
          <ConfidenceChip level={match.confidence} />
        </div>
        <p className="mt-0.5 font-mono text-xs tabular-nums text-ink-faint">
          sim {match.similarity.toFixed(3)} · readiness {match.readiness ?? "—"} ·
          context {match.contextFit ?? "—"}
        </p>
      </div>
    </div>
  );
}

function NoMatches({ outcome }: { outcome: AskOutcome }) {
  const [status, setStatus] = useState<{ status: string; candidatesFound: number | null; inQueue: number } | null>(null);
  const polling = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (outcome.sourcing !== "started") return;
    fetch("/api/worker/tick", { method: "POST" }).catch(() => {});
    polling.current = setInterval(async () => {
      const s = await sourcingStatus(outcome.problemId);
      setStatus(s);
      if (s.status === "completed" || s.status === "failed") {
        if (polling.current) clearInterval(polling.current);
      }
    }, 5000);
    return () => {
      if (polling.current) clearInterval(polling.current);
    };
  }, [outcome.problemId, outcome.sourcing]);

  const done = status?.status === "completed";
  const failed = status?.status === "failed";

  return (
    <div>
      <div className="border border-line bg-surface px-8 py-10 text-center">
        <p className="font-display text-2xl text-ink">
          Nobody in the pool is a strong fit.
        </p>
        <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-ink-secondary">
          That's a real answer, not a failure — no approved startup clears the{" "}
          {outcome.threshold.toFixed(2)} similarity bar for this problem. Rather
          than show you a weak match dressed up as a good one, we've started
          hunting the open web for field-proven candidates.
        </p>

        {outcome.sourcing === "started" && (
          <div className="mx-auto mt-6 max-w-md">
            {!done && !failed && (
              <>
                <div className="flex items-center justify-center gap-2 text-sm text-forest-deep">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-forest" />
                  Hunting externally — check back in a few minutes.
                </div>
                <div className="mt-4 space-y-2">
                  <div className="shimmer h-3.5 w-full rounded" />
                  <div className="shimmer h-3.5 w-4/5 rounded" />
                </div>
              </>
            )}
            {done && (
              <p className="text-sm text-forest-deep">
                Hunt complete — {status?.candidatesFound ?? 0} new candidate
                {status?.candidatesFound === 1 ? "" : "s"} added to the review
                queue for vetting.{" "}
                <Link href="/dashboard/queue" className="underline underline-offset-2">
                  Review them →
                </Link>
              </p>
            )}
            {failed && (
              <p className="text-sm text-err">
                The external hunt failed. You can re-trigger it from the problem
                page.
              </p>
            )}
          </div>
        )}
      </div>

      {outcome.adjacent.length > 0 && (
        <div className="mt-6">
          <p className="text-xs uppercase tracking-wider text-ink-faint">
            Adjacent — clearly short of the bar, shown for context only
          </p>
          <div className="mt-2 space-y-2 opacity-80">
            {outcome.adjacent.map((m) => (
              <ResultRow key={m.id} match={m} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
