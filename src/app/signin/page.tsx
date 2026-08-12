"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(
    params.get("denied") ? "That account is not on the team allowlist." : null
  );
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setError(null);
    setBusy(true);
    const sb = createSupabaseBrowserClient();
    const { error: err } = await sb.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (err) {
      setError("Sign-in failed — check the email and password.");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  const inputCls =
    "w-full border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-forest focus:outline-none transition-colors duration-150";

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-6">
          <Link href="/" className="text-sm font-semibold tracking-tight">
            StartupBridge
          </Link>
          <span className="text-xs uppercase tracking-wider text-ink-faint">
            Team access
          </span>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-6">
        <div className="w-full max-w-sm animate-rise">
          <h1 className="font-display text-3xl tracking-tight text-ink">
            Sign in.
          </h1>
          <p className="mt-2 text-sm text-ink-secondary">
            For program officers and the review team.
          </p>
          <div className="mt-8 space-y-4">
            <div>
              <label className="block text-xs font-medium uppercase tracking-wider text-ink-secondary">
                Email
              </label>
              <input
                className={`mt-1.5 ${inputCls}`}
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium uppercase tracking-wider text-ink-secondary">
                Password
              </label>
              <input
                className={`mt-1.5 ${inputCls}`}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && email && password && signIn()}
              />
            </div>
            {error && <p className="text-sm text-err">{error}</p>}
            <button
              onClick={signIn}
              disabled={busy || !email || !password}
              className="w-full bg-forest px-5 py-2.5 text-sm font-medium text-white transition-colors duration-200 hover:bg-forest-deep disabled:opacity-50"
            >
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}
