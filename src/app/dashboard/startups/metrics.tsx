/**
 * Traction panel. Shows what we actually know, and — just as important —
 * names what we don't, so an officer can see the shape of the evidence
 * before an introduction rather than assuming silence means zero.
 *
 * Display only. None of this feeds base_readiness.
 */

export interface MetricEntry {
  value?: number | string | null;
  period_months?: number | null;
  as_of?: string | null;
  source?: string | null;
  note?: string | null;
}

export type Metrics = Record<string, MetricEntry | undefined>;

const SLOTS: { key: string; label: string; hint: string; format?: (v: number) => string }[] = [
  {
    key: "revenue_usd",
    label: "Revenue",
    hint: "trailing period, USD",
    format: (v) => `$${v.toLocaleString()}`,
  },
  { key: "customers", label: "Customers", hint: "paying or contracted" },
  { key: "deployments", label: "Deployments", hint: "live sites or programs" },
  { key: "employees", label: "Headcount", hint: "current team size" },
  {
    key: "last_raise",
    label: "Last raise",
    hint: "most recent round, USD",
    format: (v) => `$${v.toLocaleString()}`,
  },
];

function display(entry: MetricEntry | undefined, format?: (v: number) => string) {
  if (!entry || entry.value === null || entry.value === undefined || entry.value === "") {
    return null;
  }
  if (typeof entry.value === "number" && format) return format(entry.value);
  return String(entry.value);
}

export function TractionPanel({ metrics }: { metrics: Metrics | null }) {
  const m = metrics ?? {};
  const known = SLOTS.filter((slot) => display(m[slot.key], slot.format) !== null);

  return (
    <section className="border border-line bg-surface p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-ink">Traction</h2>
        <span className="text-[11px] uppercase tracking-wider text-ink-faint">
          context only — never scored
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-5">
        {SLOTS.map((slot) => {
          const entry = m[slot.key];
          const value = display(entry, slot.format);
          return (
            <div key={slot.key} className="bg-paper px-3 py-4">
              <p className="font-mono text-lg tabular-nums leading-none tracking-tight text-ink">
                {value ?? <span className="text-ink-faint">—</span>}
              </p>
              <p className="mt-2 text-[11px] uppercase tracking-wider text-ink-secondary">
                {slot.label}
              </p>
              <p className="mt-0.5 text-[11px] leading-snug text-ink-faint">
                {value && entry?.period_months
                  ? `last ${entry.period_months} months`
                  : value && entry?.as_of
                    ? `as of ${entry.as_of}`
                    : slot.hint}
              </p>
              {value && entry?.source && (
                <p className="mt-1 text-[11px] text-ink-faint">
                  {entry.source.replace(/_/g, " ")}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {known.length === 0 && (
        <p className="mt-3 text-xs leading-relaxed text-ink-faint">
          No commercial metrics on file yet. These are populated by CSV import
          from a premium database, by enrichment when a company publishes
          them, or by a reviewer after a conversation — and stay empty rather
          than guessed.
        </p>
      )}
    </section>
  );
}
