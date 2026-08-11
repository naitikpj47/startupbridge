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

async function headCount(
  url: string,
  key: string,
  table: string,
  filter?: string
): Promise<number | null> {
  try {
    const res = await fetch(`${url}/rest/v1/${table}?select=*${filter ? `&${filter}` : ""}`, {
      method: "HEAD",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: "count=exact",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const total = res.headers.get("content-range")?.split("/")[1];
    return total && total !== "*" ? Number(total) : null;
  } catch {
    return null;
  }
}

async function databaseChecks(): Promise<Check[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    const detail = "Awaiting Supabase keys in .env.local";
    return [
      { label: "Database schema", detail, state: "waiting" },
      { label: "Seed data", detail, state: "waiting" },
    ];
  }

  const [config, startups, problems, regions, scored, vectors, briefs] =
    await Promise.all([
      headCount(url, key, "scoring_config"),
      headCount(url, key, "startups"),
      headCount(url, key, "problems"),
      headCount(url, key, "country_regions"),
      headCount(url, key, "startup_profiles", "base_readiness=not.is.null"),
      headCount(url, key, "startup_profiles", "embedding=not.is.null"),
      headCount(url, key, "problems", "enriched_brief=not.is.null"),
    ]);

  const schema: Check =
    config === null
      ? {
          label: "Database schema",
          detail: "Migrations not applied yet",
          state: "waiting",
        }
      : {
          label: "Database schema",
          detail: `Tables in place, scoring config loaded (${config} row)`,
          state: "ready",
        };

  const seed: Check =
    startups === null || problems === null
      ? {
          label: "Seed data",
          detail: "Not seeded yet",
          state: "waiting",
        }
      : {
          label: "Seed data",
          detail: `${startups} startups · ${problems} problems · ${regions ?? 0} countries mapped`,
          state: startups > 0 && problems > 0 ? "ready" : "attention",
        };

  const pipeline: Check =
    vectors === null || vectors === 0
      ? {
          label: "AI pipeline",
          detail: "Embeddings and briefs not generated yet",
          state: "waiting",
        }
      : {
          label: "AI pipeline",
          detail: `${scored} scored · ${vectors} embedded · ${briefs} problem briefs`,
          state: vectors === startups && briefs === problems ? "ready" : "attention",
        };

  return [schema, seed, pipeline];
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
    ...(await databaseChecks()),
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
              Phase 2 · Enrichment &amp; embeddings
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
            Phase 2 of 8 — enrichment, embeddings, scoring backfill.
          </p>
        </div>
      </footer>
    </div>
  );
}
