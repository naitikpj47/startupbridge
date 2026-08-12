import Link from "next/link";

/**
 * The fork. Two doors, nothing else: a program officer who needs
 * something, or a startup that wants to be found. Every other surface
 * lives behind one of these.
 */
export default function Landing() {
  return (
    <div className="flex min-h-screen flex-col">
      <main className="flex flex-1 items-center justify-center px-6">
        <div className="w-full max-w-3xl animate-rise">
          <p className="text-center text-xs uppercase tracking-[0.2em] text-ink-faint">
            StartupBridge
          </p>
          <h1 className="mt-6 text-center font-display text-4xl leading-tight tracking-tight text-ink sm:text-5xl">
            Who are you?
          </h1>

          <div className="mt-14 grid grid-cols-1 gap-px border border-line bg-line sm:grid-cols-2">
            <Link
              href="/signin"
              className="group bg-paper px-8 py-12 text-center transition-colors duration-200 ease-out hover:bg-surface"
            >
              <p className="font-display text-2xl text-ink">Program officer</p>
              <p className="mt-3 text-sm leading-relaxed text-ink-secondary">
                You have a problem that needs solving.
              </p>
              <span className="mt-6 inline-block text-sm text-forest transition-transform duration-200 ease-out group-hover:translate-x-1">
                Sign in →
              </span>
            </Link>

            <Link
              href="/submit"
              className="group bg-paper px-8 py-12 text-center transition-colors duration-200 ease-out hover:bg-surface"
            >
              <p className="font-display text-2xl text-ink">Startup</p>
              <p className="mt-3 text-sm leading-relaxed text-ink-secondary">
                You have something that works in the field.
              </p>
              <span className="mt-6 inline-block text-sm text-forest transition-transform duration-200 ease-out group-hover:translate-x-1">
                Submit your startup →
              </span>
            </Link>
          </div>
        </div>
      </main>

      <footer className="px-6 pb-8">
        <p className="text-center text-xs text-ink-faint">
          A program of the team and its partner institutions.
        </p>
      </footer>
    </div>
  );
}
