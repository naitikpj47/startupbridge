"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  beginIntake,
  commitProblem,
  askForFacts,
  type AskOutcome,
  type AskFailure,
} from "./ask-actions";
import type { AskFact } from "@/lib/askFacts";
import type {
  IntakeRead,
  IntakeAnswer,
  DraftedProblem,
} from "@/lib/intake-shared";
import { IntakeFlow } from "./intake-flow";
import { SourcingPanel } from "./sourcing-panel";

/** A "use server" module may only export async functions, so the type
 * guard for its result unions lives here. */
function failed<T extends object>(r: T | AskFailure): r is AskFailure {
  return "failed" in r;
}
import { ConfidenceChip } from "./bits";
import { CountUp } from "./count-up";

const EXAMPLES = [
  "I need something that helps decrease malaria in Thailand",
  "Rural clinics in Nepal keep losing vaccines to power cuts",
  "Farmers in Vietnam need earlier warning of saltwater intrusion",
];

const STEPS = [
  "Saving the problem statement",
  "Writing the brief",
  "Searching the pool",
  "Scoring candidates",
];

/**
 * The loading screen's other half: context on the problem the officer
 * just described, revealed one card at a time. Reading beats waiting.
 */
function FactCards({ facts }: { facts: AskFact[] }) {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (!facts.length) return;
    setShown(1);
    const timer = setInterval(
      () => setShown((n) => (n >= facts.length ? n : n + 1)),
      3500
    );
    return () => clearInterval(timer);
  }, [facts]);

  if (!facts.length) {
    return (
      <div className="space-y-3">
        <p className="text-xs uppercase tracking-wider text-ink-faint">
          While we work
        </p>
        <div className="shimmer h-16 w-full rounded" />
        <div className="shimmer h-16 w-4/5 rounded" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs uppercase tracking-wider text-ink-faint">
        While we work — context on this problem
      </p>
      {facts.slice(0, shown).map((fact, i) => (
        <div
          key={i}
          className="animate-rise border-l-2 border-forest bg-surface py-2.5 pl-4 pr-3"
        >
          <p className="text-[11px] font-medium uppercase tracking-wider text-forest">
            {fact.label}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-ink">{fact.text}</p>
        </div>
      ))}
    </div>
  );
}

type Phase =
  | { name: "ask" }
  | { name: "reading" }
  | { name: "intake"; read: IntakeRead }
  | { name: "working" }
  | { name: "done"; outcome: AskOutcome };

export function AskBox() {
  const [ask, setAsk] = useState("");
  const [phase, setPhase] = useState<Phase>({ name: "ask" });
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [facts, setFacts] = useState<AskFact[]>([]);

  const working = phase.name === "working";
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(
      () => setStep((s) => Math.min(s + 1, STEPS.length - 1)),
      4000
    );
    return () => clearInterval(timer);
  }, [working]);

  /** Step 1: read the ask and come back with questions. Nothing saved. */
  async function startIntake(text: string) {
    setError(null);
    setPhase({ name: "reading" });
    try {
      const read = await beginIntake(text);
      if (failed(read)) {
        setError(read.message);
        setPhase({ name: "ask" });
      } else {
        setPhase({ name: "intake", read });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setPhase({ name: "ask" });
    }
  }

  /** Step 3: they signed off on the statement. Save it and go looking. */
  async function commit(draft: DraftedProblem, answers: IntakeAnswer[]) {
    setError(null);
    setStep(0);
    setFacts([]);
    setPhase({ name: "working" });
    // Fired alongside the real work, never awaited before it: the cards
    // land in a couple of seconds and fill the wait, but a slow or
    // failed cards call can't hold up the answer.
    askForFacts(`${draft.title}. ${draft.description}`)
      .then(setFacts)
      .catch(() => {});

    try {
      const result = await commitProblem(draft, answers);
      if (failed(result)) {
        setError(result.message);
        setPhase({ name: "ask" });
      } else {
        setPhase({ name: "done", outcome: result });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setPhase({ name: "ask" });
    }
  }

  function reset() {
    setPhase({ name: "ask" });
    setAsk("");
    setError(null);
  }

  if (phase.name === "done") {
    return <AskResult outcome={phase.outcome} onReset={reset} />;
  }

  if (phase.name === "intake") {
    return (
      <IntakeFlow
        ask={ask}
        read={phase.read}
        onCommit={commit}
        onRestart={reset}
      />
    );
  }

  if (phase.name === "working") {
    return (
      <div className="animate-rise">
        <h1 className="font-display text-3xl leading-tight tracking-tight text-ink">
          Looking for people who've done this.
        </h1>
        <div className="mt-8 grid max-w-4xl grid-cols-1 gap-8 lg:grid-cols-[280px_1fr]">
          <div className="space-y-2">
            {STEPS.map((label, i) => (
              <div key={label} className="flex items-center gap-3">
                <span
                  className={`h-1.5 w-1.5 rounded-full transition-colors duration-300 ${
                    i <= step ? "bg-forest" : "bg-line-strong"
                  }`}
                />
                <span className={`text-sm ${i <= step ? "text-ink" : "text-ink-faint"}`}>
                  {label}
                </span>
                {i === step && <span className="shimmer h-3 flex-1 rounded" />}
              </div>
            ))}
          </div>
          <FactCards facts={facts} />
        </div>
      </div>
    );
  }

  const reading = phase.name === "reading";

  return (
    <div className="animate-rise">
      <h1 className="font-display text-4xl leading-tight tracking-tight text-ink">
        What do you need?
      </h1>
      <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-secondary">
        Describe the problem in your own words — rough is fine. We'll ask a few
        questions to get it right, write it up in your words, then go looking
        for startups that have actually done it in the field.
      </p>

      <div className="mt-8">
        <textarea
          value={ask}
          onChange={(e) => setAsk(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && ask.trim())
              startIntake(ask);
          }}
          disabled={reading}
          placeholder="I need something that helps decrease malaria in Thailand…"
          className="min-h-28 w-full border border-line bg-surface px-4 py-3 text-base leading-relaxed text-ink placeholder:text-ink-faint focus:border-forest focus:outline-none disabled:opacity-60"
        />
        <div className="mt-3 flex items-center gap-4">
          <button
            onClick={() => startIntake(ask)}
            disabled={reading || ask.trim().length < 8}
            className="bg-forest px-6 py-2.5 text-sm font-medium text-white transition-colors duration-200 hover:bg-forest-deep disabled:opacity-50"
          >
            {reading ? "Reading it…" : "Start"}
          </button>
          <span className="text-xs text-ink-faint">⌘/Ctrl + Enter</span>
        </div>
      </div>

      {reading && (
        <div className="mt-8 max-w-md space-y-2.5">
          <p className="text-xs uppercase tracking-wider text-ink-faint">
            Working out what to ask you
          </p>
          <div className="shimmer h-3 w-full rounded" />
          <div className="shimmer h-3 w-4/5 rounded" />
          <div className="shimmer h-3 w-2/3 rounded" />
        </div>
      )}

      {error && (
        <p className="mt-4 max-w-xl border-l-2 border-err bg-err-tint px-3 py-2 text-sm text-err">
          {error}
        </p>
      )}

      {!reading && (
        <div className="mt-10">
          <p className="text-xs uppercase tracking-wider text-ink-faint">
            Or try one of these
          </p>
          <div className="mt-2 space-y-1.5">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                onClick={() => {
                  setAsk(example);
                  startIntake(example);
                }}
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

      {outcome.openQuestions.length > 0 && (
        <div className="mt-5 max-w-2xl border-l-2 border-warn bg-warn-tint px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-warn">
            Still open — matched around, not guessed
          </p>
          <ul className="mt-1.5 space-y-1">
            {outcome.openQuestions.map((q) => (
              <li key={q} className="flex gap-2 text-sm leading-relaxed text-ink">
                <span className="text-warn">·</span>
                {q}
              </li>
            ))}
          </ul>
        </div>
      )}

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

        <SourcingPanel
          problemId={outcome.problemId}
          autoStarted={outcome.sourcing === "started"}
        />
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
