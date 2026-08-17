import type { ReviewFlag } from "@/lib/provenance";
import { CountUp } from "./count-up";

/** Quiet chip beside every score: "LOW (2 of 6 signals)" — never blended
 * into the score itself. */
export function ConfidenceChip({
  level,
  verified,
}: {
  level: string | null;
  verified?: number | null;
}) {
  if (!level) return null;
  const styles: Record<string, string> = {
    high: "bg-forest-tint text-forest-deep",
    medium: "bg-well text-ink-secondary",
    low: "bg-warn-tint text-warn",
  };
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ${styles[level] ?? ""}`}>
      {level}
      {verified !== undefined && verified !== null ? ` (${verified} of 6)` : ""}
    </span>
  );
}

/**
 * PPP readiness, beside the name. Only "ready" gets the forest
 * treatment — the point of the chip is to make a genuinely
 * partnership-grade company findable at a glance, not to decorate every
 * card. "Not assessable" renders nothing at all: an absent chip is the
 * honest signal for a company nobody has looked at, and a grey badge
 * saying so on 94 of 106 cards would be noise.
 */
export function PppChip({
  band,
  score,
}: {
  band: string;
  score: number | null;
}) {
  if (band === "unassessed") return null;
  const styles: Record<string, string> = {
    ready: "bg-forest text-white",
    approaching: "bg-forest-tint text-forest-deep",
    pilot_first: "bg-well text-ink-secondary",
  };
  const label: Record<string, string> = {
    ready: "PPP ready",
    approaching: "PPP approaching",
    pilot_first: "pilot first",
  };
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ${styles[band] ?? "bg-well text-ink-secondary"}`}
      title={`PPP readiness ${score ?? "—"} of 100 — can this company survive procurement and deliver at commercial scale`}
    >
      {label[band] ?? band}
      {score !== null && <span className="ml-1 font-mono tabular-nums opacity-80">{score}</span>}
    </span>
  );
}

export function StatusChip({ status }: { status: string }) {
  const styles: Record<string, string> = {
    submitted: "bg-well text-ink-secondary",
    under_review: "bg-warn-tint text-warn",
    approved: "bg-forest-tint text-forest-deep",
    rejected: "bg-err-tint text-err",
    draft: "bg-well text-ink-secondary",
    open: "bg-forest-tint text-forest-deep",
    matching: "bg-forest-tint text-forest-deep",
    closed: "bg-well text-ink-faint",
    suggested: "bg-well text-ink-secondary",
    shortlisted: "bg-forest-tint text-forest-deep",
    introduced: "bg-forest-tint text-forest-deep",
    engaged: "bg-forest-tint text-forest-deep",
    dropped: "bg-well text-ink-faint",
    queued: "bg-well text-ink-secondary",
    running: "bg-warn-tint text-warn",
    succeeded: "bg-forest-tint text-forest-deep",
    failed: "bg-err-tint text-err",
  };
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ${styles[status] ?? "bg-well text-ink-secondary"}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

export function FlagList({ flags }: { flags: ReviewFlag[] | null }) {
  if (!flags?.length) return null;
  return (
    <ul className="mt-1.5 space-y-1">
      {flags.map((flag, i) => (
        <li key={i} className="flex items-start gap-1.5 text-xs text-warn">
          <span className="mt-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />
          {flag.detail}
        </li>
      ))}
    </ul>
  );
}

export function BigScore({ value }: { value: number | null }) {
  return (
    <CountUp
      value={value}
      className="font-mono text-2xl tabular-nums tracking-tight text-ink"
    />
  );
}

export function PageTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="animate-rise">
      <h1 className="font-display text-3xl tracking-tight text-ink">{title}</h1>
      {sub && <p className="mt-1.5 text-sm text-ink-secondary">{sub}</p>}
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="border border-line bg-surface px-8 py-12 text-center">
      <p className="font-display text-xl text-ink">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-secondary">
        {body}
      </p>
    </div>
  );
}
