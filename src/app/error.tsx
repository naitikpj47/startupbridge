"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-md animate-rise text-center">
        <p className="text-xs uppercase tracking-[0.2em] text-ink-faint">
          Something went wrong
        </p>
        <h1 className="mt-4 font-display text-3xl tracking-tight text-ink">
          That didn&apos;t work.
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-secondary">
          The error has been logged. You can try again — if it keeps
          happening, the details are in the server log.
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <button
            onClick={reset}
            className="bg-forest px-5 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-forest-deep"
          >
            Try again
          </button>
          <Link
            href="/"
            className="text-sm text-ink-secondary underline-offset-2 hover:text-ink hover:underline"
          >
            Start over
          </Link>
        </div>
      </div>
    </div>
  );
}
