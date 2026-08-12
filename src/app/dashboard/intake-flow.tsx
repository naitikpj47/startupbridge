"use client";

import { useMemo, useState } from "react";
import {
  DIMENSIONS,
  checkSufficiency,
  type DimensionKey,
  type IntakeRead,
  type IntakeAnswer,
  type DraftedProblem,
} from "@/lib/intake-shared";
import { draftFromIntake, type DraftResult } from "./ask-actions";
import { DimensionIcon, Tick, Gap } from "./dimension-icons";

/**
 * The conversation between "what do you need?" and a saved problem
 * statement.
 *
 * Deliberately one question at a time: six cards stacked on a page is a
 * form, and people fill forms in as few words as possible. One question,
 * with the reason it matters and four things they might say, gets real
 * answers — and every one of those answers is theirs, which is the whole
 * point. Nothing the model suggests counts until it's clicked.
 */

type Draft = { picked: string[]; text: string; unknown: boolean };

const EMPTY: Draft = { picked: [], text: "", unknown: false };

function valueOf(d: Draft): string {
  return [...d.picked, d.text.trim()].filter(Boolean).join(" · ");
}

export function IntakeFlow({
  ask,
  read,
  onCommit,
  onRestart,
}: {
  ask: string;
  read: IntakeRead;
  onCommit: (draft: DraftedProblem, answers: IntakeAnswer[]) => void;
  onRestart: () => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => {
    // Anything their own words already covered starts pre-filled — but as
    // an editable answer they can correct, not a settled fact.
    const seed: Record<string, Draft> = {};
    for (const q of read.questions) {
      seed[q.key] = q.captured
        ? { picked: [q.captured], text: "", unknown: false }
        : { ...EMPTY };
    }
    return seed;
  });
  const [at, setAt] = useState(0);
  const [drafting, setDrafting] = useState(false);
  const [result, setResult] = useState<DraftResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const answers: IntakeAnswer[] = useMemo(
    () =>
      DIMENSIONS.map((d) => {
        const s = drafts[d.key] ?? EMPTY;
        return { key: d.key, value: valueOf(s), unknown: s.unknown };
      }),
    [drafts]
  );
  const sufficiency = useMemo(() => checkSufficiency(answers), [answers]);

  const question = read.questions[at];
  const dimension = DIMENSIONS[at];
  const current = drafts[dimension.key] ?? EMPTY;

  function update(key: DimensionKey, patch: Partial<Draft>) {
    setDrafts((d) => ({ ...d, [key]: { ...(d[key] ?? EMPTY), ...patch } }));
  }

  function toggle(key: DimensionKey, option: string) {
    const s = drafts[key] ?? EMPTY;
    const picked = s.picked.includes(option)
      ? s.picked.filter((p) => p !== option)
      : [...s.picked, option];
    update(key, { picked, unknown: false });
  }

  async function buildDraft() {
    setError(null);
    setDrafting(true);
    try {
      const r = await draftFromIntake(ask, answers);
      if ("failed" in r) setError(r.message);
      else setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setDrafting(false);
    }
  }

  if (result) {
    return (
      <DraftReview
        result={result}
        onBack={() => setResult(null)}
        onConfirm={(edited) => onCommit(edited, answers)}
      />
    );
  }

  const last = at === DIMENSIONS.length - 1;

  return (
    <div className="animate-rise">
      <button
        onClick={onRestart}
        className="text-xs text-ink-secondary underline-offset-2 hover:text-ink hover:underline"
      >
        ← Start over
      </button>

      <div className="mt-4 border-l-2 border-forest bg-forest-tint/50 py-3 pl-4 pr-4">
        <p className="text-[11px] font-medium uppercase tracking-wider text-forest">
          What I understood
        </p>
        <p className="mt-1 text-sm leading-relaxed text-ink">{read.understood}</p>
      </div>

      <p className="mt-5 max-w-2xl text-sm leading-relaxed text-ink-secondary">
        Six quick questions so the write-up is yours, not a guess. Click what
        fits, type anything, or skip — a skipped question is recorded as an
        open question, never filled in for you.
      </p>

      <div className="mt-7 grid grid-cols-1 gap-8 lg:grid-cols-[210px_1fr]">
        <Rail
          at={at}
          drafts={drafts}
          onJump={setAt}
          sufficiency={sufficiency}
        />

        <div className="min-w-0">
          <div key={dimension.key} className="animate-rise">
            <div className="flex items-start gap-3.5">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-forest/30 bg-forest-tint text-forest">
                <DimensionIcon name={dimension.icon} className="h-4.5 w-4.5" />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-medium uppercase tracking-wider text-ink-faint">
                  {dimension.label} · {at + 1} of {DIMENSIONS.length}
                </p>
                <h2 className="mt-1 font-display text-2xl leading-snug tracking-tight text-ink">
                  {question.question}
                </h2>
                {question.why && (
                  <p className="mt-1.5 text-xs leading-relaxed text-ink-secondary">
                    {question.why}
                  </p>
                )}
              </div>
            </div>

            {question.quote && (
              <p className="mt-4 border-l-2 border-line-strong pl-3 text-xs italic text-ink-secondary">
                You already said: "{question.quote}" — edit it if that's not
                quite right.
              </p>
            )}

            {question.options.length > 0 && (
              <div className="mt-5 flex flex-wrap gap-2">
                {question.options.map((option) => {
                  const on = current.picked.includes(option);
                  return (
                    <button
                      key={option}
                      onClick={() => toggle(dimension.key, option)}
                      aria-pressed={on}
                      className={`flex items-center gap-1.5 border px-3 py-1.5 text-left text-sm transition-colors duration-150 ${
                        on
                          ? "border-forest bg-forest text-white"
                          : "border-line-strong bg-surface text-ink hover:border-forest hover:text-forest"
                      }`}
                    >
                      {on && <Tick className="h-3 w-3 shrink-0" />}
                      {option}
                    </button>
                  );
                })}
              </div>
            )}

            {current.picked.filter((p) => !question.options.includes(p)).map((p) => (
              <div
                key={p}
                className="mt-2 flex items-start gap-1.5 border border-forest bg-forest px-3 py-1.5 text-sm text-white"
              >
                <Tick className="mt-1 h-3 w-3 shrink-0" />
                <span className="flex-1">{p}</span>
                <button
                  onClick={() => toggle(dimension.key, p)}
                  className="shrink-0 text-white/70 hover:text-white"
                  aria-label="Remove"
                >
                  ×
                </button>
              </div>
            ))}

            <textarea
              value={current.text}
              onChange={(e) =>
                update(dimension.key, { text: e.target.value, unknown: false })
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  last ? buildDraft() : setAt(at + 1);
                }
              }}
              placeholder="Or say it in your own words…"
              className="mt-3 min-h-20 w-full border border-line bg-surface px-3.5 py-2.5 text-sm leading-relaxed text-ink placeholder:text-ink-faint focus:border-forest focus:outline-none"
            />

            <div className="mt-4 flex flex-wrap items-center gap-3">
              {at > 0 && (
                <button
                  onClick={() => setAt(at - 1)}
                  className="border border-line px-3.5 py-2 text-sm text-ink-secondary hover:bg-well"
                >
                  ← Back
                </button>
              )}
              <button
                onClick={() => (last ? buildDraft() : setAt(at + 1))}
                disabled={drafting}
                className="bg-forest px-5 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-forest-deep disabled:opacity-50"
              >
                {last ? (drafting ? "Writing it up…" : "Write it up") : "Next →"}
              </button>
              <button
                onClick={() => {
                  update(dimension.key, { picked: [], text: "", unknown: true });
                  if (!last) setAt(at + 1);
                }}
                className="text-sm text-ink-faint underline-offset-2 hover:text-ink hover:underline"
              >
                I don't know this
              </button>
              <span className="text-xs text-ink-faint">⌘/Ctrl + Enter</span>
            </div>
          </div>

          {!last && sufficiency.ok && (
            <div className="mt-6 border-t border-line pt-4">
              <button
                onClick={buildDraft}
                disabled={drafting}
                className="text-sm text-forest underline underline-offset-2 disabled:opacity-50"
              >
                {drafting
                  ? "Writing it up…"
                  : "That's enough — write it up now, leave the rest open →"}
              </button>
            </div>
          )}

          {error && (
            <p className="mt-4 border-l-2 border-err bg-err-tint px-3 py-2 text-sm text-err">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** The progress rail — six marks, filling in as they're answered. */
function Rail({
  at,
  drafts,
  onJump,
  sufficiency,
}: {
  at: number;
  drafts: Record<string, Draft>;
  onJump: (i: number) => void;
  sufficiency: ReturnType<typeof checkSufficiency>;
}) {
  const done = sufficiency.confirmed.length;
  return (
    <div className="lg:sticky lg:top-8 lg:self-start">
      <ol className="relative space-y-1">
        <span
          aria-hidden
          className="absolute left-[13px] top-3 bottom-3 w-px bg-line"
        />
        {DIMENSIONS.map((d, i) => {
          const s = drafts[d.key] ?? EMPTY;
          const answered = !s.unknown && valueOf(s).trim().length >= 3;
          const here = i === at;
          return (
            <li key={d.key} className="relative">
              <button
                onClick={() => onJump(i)}
                className="flex w-full items-center gap-2.5 py-1 text-left"
              >
                <span
                  className={`relative z-10 flex h-[27px] w-[27px] shrink-0 items-center justify-center rounded-full border transition-colors duration-200 ${
                    answered
                      ? "border-forest bg-forest text-white"
                      : s.unknown
                        ? "border-line-strong bg-paper text-ink-faint"
                        : here
                          ? "border-forest bg-surface text-forest"
                          : "border-line bg-surface text-ink-faint"
                  }`}
                >
                  {answered ? (
                    <Tick />
                  ) : s.unknown ? (
                    <Gap />
                  ) : (
                    <DimensionIcon name={d.icon} className="h-3.5 w-3.5" />
                  )}
                </span>
                <span className="min-w-0">
                  <span
                    className={`block truncate text-xs ${
                      here ? "font-semibold text-ink" : "text-ink-secondary"
                    }`}
                  >
                    {d.label}
                  </span>
                  <span className="block truncate text-[10px] text-ink-faint">
                    {s.unknown ? "left open" : answered ? "answered" : d.blurb}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="mt-5 border-t border-line pt-4">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wider text-ink-faint">
            Enough to draft
          </span>
          <span
            className={`text-[11px] font-medium ${
              sufficiency.ok ? "text-forest" : "text-ink-faint"
            }`}
          >
            {sufficiency.ok ? "yes" : "not yet"}
          </span>
        </div>
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-line">
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              sufficiency.ok ? "bg-forest" : "bg-line-strong"
            }`}
            style={{ width: `${(done / DIMENSIONS.length) * 100}%` }}
          />
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-secondary">
          {sufficiency.message}
        </p>
      </div>
    </div>
  );
}

/**
 * Last stop before anything is saved. The statement is editable, and the
 * gaps are shown as gaps — the officer signs off on both.
 */
function DraftReview({
  result,
  onBack,
  onConfirm,
}: {
  result: DraftResult;
  onBack: () => void;
  onConfirm: (draft: DraftedProblem) => void;
}) {
  const [title, setTitle] = useState(result.draft.title);
  const [description, setDescription] = useState(result.draft.description);
  const gaps = result.draft.open_questions;

  return (
    <div className="animate-rise max-w-2xl">
      <button
        onClick={onBack}
        className="text-xs text-ink-secondary underline-offset-2 hover:text-ink hover:underline"
      >
        ← Back to the questions
      </button>

      <p className="mt-4 text-[11px] font-medium uppercase tracking-wider text-ink-faint">
        Your problem statement — nothing saved yet
      </p>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="mt-2 w-full border-b border-line bg-transparent pb-2 font-display text-3xl leading-tight tracking-tight text-ink focus:border-forest focus:outline-none"
      />

      <p className="mt-2 text-xs uppercase tracking-wider text-ink-faint">
        {[result.draft.country, result.draft.sector, ...result.draft.sdg_tags]
          .filter(Boolean)
          .join(" · ") || "scope unspecified"}
      </p>

      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className="mt-4 min-h-44 w-full border border-line bg-surface px-4 py-3 text-sm leading-relaxed text-ink focus:border-forest focus:outline-none"
      />
      <p className="mt-1.5 text-xs text-ink-faint">
        Built only from what you confirmed. Edit anything that isn't right —
        this is what gets matched against.
      </p>

      {gaps.length > 0 && (
        <div className="mt-6 border-l-2 border-warn bg-warn-tint px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-warn">
            Left open — carried forward, not guessed
          </p>
          <ul className="mt-2 space-y-1">
            {gaps.map((q) => (
              <li key={q} className="flex gap-2 text-sm leading-relaxed text-ink">
                <span className="text-warn">·</span>
                {q}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-7 flex flex-wrap items-center gap-4 border-t border-line pt-5">
        <button
          onClick={() => onConfirm({ ...result.draft, title, description })}
          disabled={title.trim().length < 4 || description.trim().length < 20}
          className="bg-forest px-6 py-2.5 text-sm font-medium text-white transition-colors duration-200 hover:bg-forest-deep disabled:opacity-50"
        >
          Looks right — find me someone
        </button>
        <span className="text-xs text-ink-faint">
          Saves the problem and searches the pool
        </span>
      </div>
    </div>
  );
}
