import Link from "next/link";
import { requireOfficer } from "@/lib/server/auth";
import { signOut } from "./actions";

export const dynamic = "force-dynamic";

const NAV = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/queue", label: "Review queue" },
  { href: "/dashboard/startups", label: "Startups" },
  { href: "/dashboard/problems", label: "Problems" },
  { href: "/dashboard/config", label: "Scoring config" },
  { href: "/dashboard/import", label: "CSV import" },
];

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { email } = await requireOfficer();

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r border-line">
        <div className="sticky top-0 flex h-screen flex-col p-5">
          <Link href="/dashboard" className="text-sm font-semibold tracking-tight">
            StartupBridge
          </Link>
          <p className="mt-0.5 text-xs uppercase tracking-wider text-ink-faint">
            Internal
          </p>
          <nav className="mt-8 space-y-0.5">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="block px-2 py-1.5 text-sm text-ink-secondary transition-colors duration-150 hover:bg-well hover:text-ink"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="mt-auto space-y-2 border-t border-line pt-4">
            <p className="truncate text-xs text-ink-faint" title={email}>
              {email}
            </p>
            <div className="flex items-center gap-3">
              <Link href="/" className="text-xs text-ink-secondary hover:text-ink">
                Public site
              </Link>
              <Link href="/status" className="text-xs text-ink-secondary hover:text-ink">
                Status
              </Link>
              <form action={signOut}>
                <button className="text-xs text-ink-secondary underline-offset-2 hover:text-ink hover:underline">
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-5xl px-8 py-10">{children}</div>
      </main>
    </div>
  );
}
