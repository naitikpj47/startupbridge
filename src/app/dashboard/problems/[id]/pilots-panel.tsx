"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BUDGET_DEFAULT_USD,
  DURATION_DEFAULT_MONTHS,
  DURATION_MAX_MONTHS,
  PILOT_OUTCOMES,
  SCALE_DECISIONS,
  PPP_STAGES,
  type PilotObjective,
  type PilotMilestone,
  type PathwayStage,
} from "@/lib/pilots-shared";
import {
  savePilot,
  setPilotStatus,
  recordPilotOutcome,
  setScaleDecision,
  savePathwayStage,
} from "../../pilot-actions";
import { StatusChip } from "../../bits";

/**
 * From a chosen startup to funded terms to — when it works — a pathway
 * toward commercial scale.
 *
 * Everything here is officer-authored. The only prefill is the
 * officer's own confirmed intake answer on "what good looks like",
 * verbatim, because a pilot's objectives ARE that answer with a budget
 * attached.
 */

export interface PilotData {
  budgetUsd: number;
  durationMonths: number;
  startedOn: string | null;
  objectives: PilotObjective[];
  milestones: PilotMilestone[];
  status: string;
  outcome: string | null;
  outcomeNotes: string | null;
  scaleDecision: string | null;
  pathwayStages: PathwayStage[];
}

export interface PilotMatchRow {
  matchId: string;
  startupId: string;
  startupName: string;
  matchStatus: string;
  pilot: PilotData | null;
}

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function PilotsPanel({
  problemId,
  rows,
  seeds,
}: {
  problemId: string;
  rows: PilotMatchRow[];
  seeds: PilotObjective[];
}) {
  if (rows.length === 0) {
    return (
      <p className="mt-3 text-sm leading-relaxed text-ink-secondary">
        Shortlist a startup above and it appears here, ready for pilot terms —
        budget, implementation window, and the objectives it has to hit.
      </p>
    );
  }
  return (
    <div className="mt-4 space-y-3">
      {rows.map((row) => (
        <PilotCard key={row.matchId} problemId={problemId} row={row} seeds={seeds} />
      ))}
    </div>
  );
}

function PilotCard({
  problemId,
  row,
  seeds,
}: {
  problemId: string;
  row: PilotMatchRow;
  seeds: PilotObjective[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const p = row.pilot;

  async function run(action: () => Promise<{ error?: string }>) {
    setError(null);
    setBusy(true);
    try {
      const r = await action();
      if (r.error) setError(r.error);
      else router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="animate-rise border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/dashboard/startups/${row.startupId}`}
            className="text-sm font-semibold text-ink underline-offset-2 hover:underline"
          >
            {row.startupName}
          </Link>
          <StatusChip status={row.matchStatus} />
          {p && <StatusChip status={p.status} />}
        </div>
        {p && !editing && (
          <p className="font-mono text-sm tabular-nums text-ink">
            {usd.format(p.budgetUsd)} · {p.durationMonths} mo
            {p.startedOn ? ` · from ${p.startedOn}` : ""}
          </p>
        )}
      </div>

      {!p && !editing && (
        <button
          onClick={() => setEditing(true)}
          className="mt-3 border border-forest px-3.5 py-1.5 text-xs font-medium text-forest transition-colors duration-150 hover:bg-forest hover:text-white"
        >
          Design a pilot — {usd.format(BUDGET_DEFAULT_USD)} over{" "}
          {DURATION_DEFAULT_MONTHS} months to start from
        </button>
      )}

      {editing && (
        <PilotDesigner
          problemId={problemId}
          matchId={row.matchId}
          existing={p}
          seeds={seeds}
          onDone={() => {
            setEditing(false);
            router.refresh();
          }}
          onCancel={() => setEditing(false)}
        />
      )}

      {p && !editing && (
        <>
          <ul className="mt-3 space-y-1.5">
            {p.objectives.map((o, i) => (
              <li key={i} className="flex gap-2 text-sm leading-relaxed text-ink">
                <span className="font-mono text-xs text-ink-faint">{i + 1}.</span>
                <span>
                  {o.text}
                  {o.measure && (
                    <span className="text-ink-secondary"> — measured by {o.measure}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {p.milestones.length > 0 && (
            <p className="mt-2 text-xs text-ink-faint">
              {p.milestones
                .map((m) => `M${m.month}: ${m.deliverable}`)
                .join(" · ")}
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3">
            {(p.status === "drafted" || p.status === "agreed") && (
              <>
                <button
                  onClick={() => setEditing(true)}
                  className="text-xs text-ink-secondary underline-offset-2 hover:text-ink hover:underline"
                >
                  Edit terms
                </button>
                {p.status === "drafted" && (
                  <ActionButton
                    label="Mark agreed"
                    busy={busy}
                    onClick={() =>
                      run(() => setPilotStatus(problemId, row.matchId, "agreed"))
                    }
                  />
                )}
                {p.status === "agreed" && (
                  <ActionButton
                    label="Pilot is underway"
                    busy={busy}
                    onClick={() =>
                      run(() => setPilotStatus(problemId, row.matchId, "underway"))
                    }
                  />
                )}
              </>
            )}
            {p.status === "underway" && (
              <OutcomeRecorder
                busy={busy}
                onRecord={(outcome, notes) =>
                  run(() => recordPilotOutcome(problemId, row.matchId, outcome, notes))
                }
              />
            )}
            {(p.status === "drafted" || p.status === "agreed" || p.status === "underway") && (
              <button
                onClick={() =>
                  run(() => setPilotStatus(problemId, row.matchId, "cancelled"))
                }
                className="text-xs text-ink-faint underline-offset-2 hover:text-err hover:underline"
              >
                Cancel pilot
              </button>
            )}
          </div>

          {p.status === "completed" && (
            <CompletedBlock
              pilot={p}
              busy={busy}
              onDecide={(d) => run(() => setScaleDecision(problemId, row.matchId, d))}
              onStage={(key, done, note) =>
                run(() => savePathwayStage(problemId, row.matchId, key, done, note))
              }
            />
          )}
        </>
      )}

      {error && (
        <p className="mt-3 border-l-2 border-err bg-err-tint px-3 py-2 text-sm text-err">
          {error}
        </p>
      )}
    </div>
  );
}

function ActionButton({
  label,
  busy,
  onClick,
}: {
  label: string;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="bg-forest px-3 py-1.5 text-xs font-medium text-white transition-colors duration-150 hover:bg-forest-deep disabled:opacity-50"
    >
      {label}
    </button>
  );
}

/** Budget, window, objectives, milestones — one form, officer-authored. */
function PilotDesigner({
  problemId,
  matchId,
  existing,
  seeds,
  onDone,
  onCancel,
}: {
  problemId: string;
  matchId: string;
  existing: PilotData | null;
  seeds: PilotObjective[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const seeded = !existing && seeds.length > 0;
  const [budget, setBudget] = useState(String(existing?.budgetUsd ?? BUDGET_DEFAULT_USD));
  const [months, setMonths] = useState(
    String(existing?.durationMonths ?? DURATION_DEFAULT_MONTHS)
  );
  const [startedOn, setStartedOn] = useState(existing?.startedOn ?? "");
  const [objectives, setObjectives] = useState<PilotObjective[]>(
    existing?.objectives.length
      ? existing.objectives
      : seeded
        ? seeds
        : [{ text: "", measure: "" }]
  );
  const [milestones, setMilestones] = useState<PilotMilestone[]>(
    existing?.milestones ?? []
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    setBusy(true);
    try {
      const r = await savePilot(problemId, matchId, {
        budgetUsd: Number(budget.replace(/[,$\s]/g, "")),
        durationMonths: Number(months),
        startedOn: startedOn || null,
        objectives,
        milestones,
      });
      if (r.error) setError(r.error);
      else onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the pilot.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 border-t border-line pt-3">
      <div className="flex flex-wrap items-end gap-4">
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-wider text-ink-secondary">
            Budget (USD)
          </span>
          <input
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            inputMode="numeric"
            className="mt-1 w-32 border border-line bg-surface px-2.5 py-1.5 font-mono text-sm tabular-nums focus:border-forest focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-wider text-ink-secondary">
            Timeline (months)
          </span>
          <input
            value={months}
            onChange={(e) => setMonths(e.target.value)}
            inputMode="numeric"
            className="mt-1 w-24 border border-line bg-surface px-2.5 py-1.5 font-mono text-sm tabular-nums focus:border-forest focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-wider text-ink-secondary">
            Start date (optional)
          </span>
          <input
            type="date"
            value={startedOn}
            onChange={(e) => setStartedOn(e.target.value)}
            className="mt-1 border border-line bg-surface px-2.5 py-1 text-sm focus:border-forest focus:outline-none"
          />
        </label>
      </div>
      <p className="mt-1.5 text-xs text-ink-faint">
        Timeline runs 1–{DURATION_MAX_MONTHS} months. Defaults are a starting
        point, not a policy.
      </p>

      <p className="mt-4 text-[11px] font-medium uppercase tracking-wider text-ink-secondary">
        Objectives — what this pilot exists to achieve
      </p>
      {seeded && (
        <p className="mt-1 text-xs text-forest-deep">
          Seeded from your own intake answer on what good looks like — your
          words, edit freely.
        </p>
      )}
      <div className="mt-2 space-y-2">
        {objectives.map((o, i) => (
          <div key={i} className="flex items-start gap-2">
            <input
              value={o.text}
              onChange={(e) =>
                setObjectives((prev) =>
                  prev.map((x, j) => (j === i ? { ...x, text: e.target.value } : x))
                )
              }
              placeholder="Objective — e.g. confirmed cases detected within 48 hours of onset"
              className="min-w-0 flex-[2] border border-line bg-surface px-2.5 py-1.5 text-sm placeholder:text-ink-faint focus:border-forest focus:outline-none"
            />
            <input
              value={o.measure}
              onChange={(e) =>
                setObjectives((prev) =>
                  prev.map((x, j) => (j === i ? { ...x, measure: e.target.value } : x))
                )
              }
              placeholder="How it's measured"
              className="min-w-0 flex-1 border border-line bg-surface px-2.5 py-1.5 text-sm placeholder:text-ink-faint focus:border-forest focus:outline-none"
            />
            <button
              onClick={() => setObjectives((prev) => prev.filter((_, j) => j !== i))}
              aria-label="Remove objective"
              className="mt-1 shrink-0 text-ink-faint hover:text-err"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button
        onClick={() => setObjectives((prev) => [...prev, { text: "", measure: "" }])}
        className="mt-2 text-xs text-forest underline-offset-2 hover:underline"
      >
        + Add objective
      </button>

      <p className="mt-4 text-[11px] font-medium uppercase tracking-wider text-ink-secondary">
        Milestones (optional)
      </p>
      <div className="mt-2 space-y-2">
        {milestones.map((m, i) => (
          <div key={i} className="flex items-start gap-2">
            <label className="flex shrink-0 items-center gap-1 text-xs text-ink-secondary">
              Month
              <input
                value={String(m.month || "")}
                onChange={(e) =>
                  setMilestones((prev) =>
                    prev.map((x, j) =>
                      j === i ? { ...x, month: Number(e.target.value) } : x
                    )
                  )
                }
                inputMode="numeric"
                className="w-14 border border-line bg-surface px-2 py-1.5 font-mono text-sm tabular-nums focus:border-forest focus:outline-none"
              />
            </label>
            <input
              value={m.deliverable}
              onChange={(e) =>
                setMilestones((prev) =>
                  prev.map((x, j) =>
                    j === i ? { ...x, deliverable: e.target.value } : x
                  )
                )
              }
              placeholder="Deliverable due"
              className="min-w-0 flex-1 border border-line bg-surface px-2.5 py-1.5 text-sm placeholder:text-ink-faint focus:border-forest focus:outline-none"
            />
            <button
              onClick={() => setMilestones((prev) => prev.filter((_, j) => j !== i))}
              aria-label="Remove milestone"
              className="mt-1 shrink-0 text-ink-faint hover:text-err"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button
        onClick={() =>
          setMilestones((prev) => [...prev, { month: 0, deliverable: "" }])
        }
        className="mt-2 text-xs text-forest underline-offset-2 hover:underline"
      >
        + Add milestone
      </button>

      {error && (
        <p className="mt-3 border-l-2 border-err bg-err-tint px-3 py-2 text-sm text-err">
          {error}
        </p>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={save}
          disabled={busy}
          className="bg-forest px-4 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-forest-deep disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save pilot terms"}
        </button>
        <button
          onClick={onCancel}
          className="text-sm text-ink-secondary underline-offset-2 hover:text-ink hover:underline"
        >
          Discard
        </button>
      </div>
    </div>
  );
}

function OutcomeRecorder({
  busy,
  onRecord,
}: {
  busy: boolean;
  onRecord: (outcome: string, notes: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<string>("");
  const [notes, setNotes] = useState("");

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="bg-forest px-3 py-1.5 text-xs font-medium text-white transition-colors duration-150 hover:bg-forest-deep"
      >
        Record the outcome
      </button>
    );
  }
  return (
    <div className="w-full">
      <div className="flex flex-wrap gap-2">
        {PILOT_OUTCOMES.map((o) => (
          <button
            key={o.key}
            onClick={() => setOutcome(o.key)}
            aria-pressed={outcome === o.key}
            className={`border px-3 py-1.5 text-xs transition-colors duration-150 ${
              outcome === o.key
                ? "border-forest bg-forest text-white"
                : "border-line-strong bg-surface text-ink hover:border-forest"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="What actually happened, against the objectives — this is the record the scale-up case rests on."
        className="mt-2 min-h-20 w-full border border-line bg-surface px-3 py-2 text-sm placeholder:text-ink-faint focus:border-forest focus:outline-none"
      />
      <button
        onClick={() => outcome && onRecord(outcome, notes)}
        disabled={busy || !outcome}
        className="mt-2 bg-forest px-3.5 py-1.5 text-xs font-medium text-white transition-colors duration-150 hover:bg-forest-deep disabled:opacity-50"
      >
        Save outcome — completes the pilot
      </button>
    </div>
  );
}

/** Outcome + scale decision + the PPP pathway tracker. */
function CompletedBlock({
  pilot: p,
  busy,
  onDecide,
  onStage,
}: {
  pilot: PilotData;
  busy: boolean;
  onDecide: (decision: string) => void;
  onStage: (key: string, done: boolean, note: string) => void;
}) {
  const outcomeLabel =
    PILOT_OUTCOMES.find((o) => o.key === p.outcome)?.label ?? p.outcome;
  const decisionLabel = SCALE_DECISIONS.find((d) => d.key === p.scaleDecision)?.label;

  return (
    <div className="mt-3 border-t border-line pt-3">
      <p className="text-sm text-ink">
        <span className="font-medium">Outcome:</span> {outcomeLabel}
      </p>
      {p.outcomeNotes && (
        <p className="mt-1 border-l-2 border-line-strong pl-3 text-sm leading-relaxed text-ink-secondary">
          {p.outcomeNotes}
        </p>
      )}

      {!p.scaleDecision ? (
        <div className="mt-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-ink-secondary">
            Where does it go from here?
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {SCALE_DECISIONS.map((d) => (
              <button
                key={d.key}
                onClick={() => onDecide(d.key)}
                disabled={busy}
                className="border border-line-strong bg-surface px-3 py-1.5 text-xs text-ink transition-colors duration-150 hover:border-forest hover:text-forest disabled:opacity-50"
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p className="mt-2 text-sm text-forest-deep">{decisionLabel}</p>
      )}

      {p.scaleDecision === "recommend_ppp" && (
        <PathwayTracker stages={p.pathwayStages} busy={busy} onStage={onStage} />
      )}
    </div>
  );
}

function PathwayTracker({
  stages,
  busy,
  onStage,
}: {
  stages: PathwayStage[];
  busy: boolean;
  onStage: (key: string, done: boolean, note: string) => void;
}) {
  const byKey = new Map(stages.map((s) => [s.key, s]));
  const doneCount = PPP_STAGES.filter((d) => byKey.get(d.key)?.done).length;

  return (
    <div className="mt-4">
      <div className="flex items-baseline justify-between">
        <p className="text-[11px] font-medium uppercase tracking-wider text-ink-secondary">
          Pathway to commercial scale — public-private partnership
        </p>
        <span className="font-mono text-xs tabular-nums text-ink-secondary">
          {doneCount} of {PPP_STAGES.length}
        </span>
      </div>
      <ol className="mt-2 space-y-2">
        {PPP_STAGES.map((def, i) => (
          <StageRow
            key={def.key}
            index={i + 1}
            def={def}
            stage={byKey.get(def.key) ?? { key: def.key, done: false, note: "" }}
            busy={busy}
            onSave={onStage}
          />
        ))}
      </ol>
    </div>
  );
}

function StageRow({
  index,
  def,
  stage,
  busy,
  onSave,
}: {
  index: number;
  def: (typeof PPP_STAGES)[number];
  stage: PathwayStage;
  busy: boolean;
  onSave: (key: string, done: boolean, note: string) => void;
}) {
  const [note, setNote] = useState(stage.note);
  const [open, setOpen] = useState(false);
  const dirty = note !== stage.note;

  return (
    <li
      className={`border p-3 ${
        stage.done ? "border-forest/40 bg-forest-tint/40" : "border-line bg-surface"
      }`}
    >
      <div className="flex items-start gap-2.5">
        <button
          onClick={() => onSave(def.key, !stage.done, note)}
          disabled={busy}
          role="checkbox"
          aria-checked={stage.done}
          aria-label={`Mark "${def.title}" ${stage.done ? "not done" : "done"}`}
          className={`mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center border transition-colors duration-150 ${
            stage.done
              ? "border-forest bg-forest text-white"
              : "border-line-strong bg-surface hover:border-forest"
          }`}
        >
          {stage.done && "✓"}
        </button>
        <div className="min-w-0 flex-1">
          <button
            onClick={() => setOpen((o) => !o)}
            className="text-left text-sm font-medium text-ink"
          >
            {index}. {def.title}
          </button>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-secondary">{def.blurb}</p>
          {(open || stage.note) && (
            <div className="mt-2">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Notes for this stage — named counterparts, dates, blockers…"
                className="min-h-16 w-full border border-line bg-surface px-2.5 py-1.5 text-sm placeholder:text-ink-faint focus:border-forest focus:outline-none"
              />
              {dirty && (
                <button
                  onClick={() => onSave(def.key, stage.done, note)}
                  disabled={busy}
                  className="mt-1.5 bg-forest px-3 py-1 text-xs font-medium text-white hover:bg-forest-deep disabled:opacity-50"
                >
                  Save note
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
