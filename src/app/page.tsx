import Link from "next/link";

/**
 * Landing: one screen, crisp value prop, single CTA.
 */
export default function Landing() {
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
        <div className="mx-auto w-full max-w-6xl px-6 pt-28 pb-20">
          <div className="max-w-3xl animate-rise">
            <h1 className="font-display text-5xl leading-[1.08] tracking-tight text-ink sm:text-6xl">
              Field-tested technology, introduced where it's needed.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-secondary">
              We match development-focused startups with public-sector problem
              statements across Asia-Pacific — on evidence of deployment, not
              pitch decks. Program officers review every profile before any
              introduction is made.
            </p>
            <div className="mt-10">
              <Link
                href="/submit"
                className="inline-block bg-forest px-7 py-3.5 text-sm font-medium text-white transition-colors duration-200 ease-out hover:bg-forest-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"
              >
                Submit your startup
              </Link>
            </div>
          </div>

          <div className="mt-24 grid max-w-3xl grid-cols-1 gap-px border-y border-line sm:grid-cols-3">
            {[
              {
                step: "01",
                title: "Submit",
                body: "Paste your website — we draft your profile, you confirm the facts, including proof-of-concept evidence.",
              },
              {
                step: "02",
                title: "Review",
                body: "The team verifies deployability signals. Startups without field evidence are held, not rejected.",
              },
              {
                step: "03",
                title: "Introduction",
                body: "When a problem statement fits, program officers make a direct, briefed introduction.",
              },
            ].map((item) => (
              <div key={item.step} className="border-b border-line py-6 pr-8 last:border-b-0 sm:border-b-0">
                <p className="font-mono text-xs tabular-nums text-forest">{item.step}</p>
                <p className="mt-2 text-sm font-semibold text-ink">{item.title}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-secondary">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-6">
          <p className="text-xs text-ink-faint">
            A program of the team and its partner institutions.
          </p>
          <Link
            href="/status"
            className="text-xs text-ink-faint underline-offset-2 transition-colors duration-150 hover:text-ink-secondary hover:underline"
          >
            Build status
          </Link>
        </div>
      </footer>
    </div>
  );
}
