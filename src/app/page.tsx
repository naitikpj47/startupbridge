export const dynamic = "force-dynamic";

type CheckState = "ready" | "waiting" | "attention";

type Check = {
  label: string;
  detail: string;
  state: CheckState;
};

async function supabaseCheck(): Promise<Check> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return {
      label: "Supabase connection",
      detail: "Awaiting project keys in .env.local",
      state: "waiting",
    };
  }

  try {
    const res = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: key },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      return {
        label: "Supabase connection",
        detail: "Connected",
        state: "ready",
      };
    }
    return {
      label: "Supabase connection",
      detail: `Keys present, but the project responded with status ${res.status}`,
      state: "attention",
    };
  } catch {
    return {
      label: "Supabase connection",
      detail: "Keys present, but the project could not be reached",
      state: "attention",
    };
  }
}

const chipStyles: Record<CheckState, string> = {
  ready: "bg-forest-tint text-forest-deep",
  waiting: "bg-well text-ink-secondary",
  attention: "bg-warn-tint text-warn",
};

const chipLabels: Record<CheckState, string> = {
  ready: "Ready",
  waiting: "Waiting",
  attention: "Check",
};

export default async function Home() {
  const checks: Check[] = [
    {
      label: "Application scaffold",
      detail: "Next.js, TypeScript, Tailwind",
      state: "ready",
    },
    {
      label: "Environment file",
      detail: process.env.ANTHROPIC_MODEL
        ? ".env.local loaded"
        : ".env.local present, values pending",
      state: process.env.ANTHROPIC_MODEL ? "ready" : "waiting",
    },
    await supabaseCheck(),
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-6">
          <span className="text-sm font-semibold tracking-tight">
            StartupBridge
          </span>
          <span className="text-xs uppercase tracking-wider text-ink-faint">
            Working name
          </span>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto w-full max-w-6xl px-6 py-24">
          <div className="max-w-2xl animate-rise">
            <p className="text-xs font-medium uppercase tracking-widest text-forest">
              Phase 0 · Scaffold
            </p>
            <h1 className="mt-4 font-display text-4xl leading-tight tracking-tight text-ink sm:text-5xl">
              Deployable startups, matched to real problem statements.
            </h1>
            <p className="mt-5 text-base leading-relaxed text-ink-secondary">
              A matchmaking platform connecting development-focused startups
              with problem statements posted by program officers. This page
              reports setup status while the foundation is laid.
            </p>
          </div>

          <div className="mt-16 max-w-2xl border-t border-line">
            {checks.map((check) => (
              <div
                key={check.label}
                className="flex items-baseline justify-between gap-6 border-b border-line py-4"
              >
                <div>
                  <p className="text-sm font-medium text-ink">{check.label}</p>
                  <p className="mt-1 text-sm text-ink-secondary">
                    {check.detail}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium uppercase tracking-wider ${chipStyles[check.state]}`}
                >
                  {chipLabels[check.state]}
                </span>
              </div>
            ))}
          </div>
        </div>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center px-6">
          <p className="text-xs text-ink-faint">
            Phase 0 of 8 — scaffold, environment, database connection.
          </p>
        </div>
      </footer>
    </div>
  );
}
