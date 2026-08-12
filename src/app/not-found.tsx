import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-md animate-rise text-center">
        <p className="font-mono text-xs tabular-nums tracking-widest text-ink-faint">
          404
        </p>
        <h1 className="mt-4 font-display text-3xl tracking-tight text-ink">
          Nothing here.
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-secondary">
          That page doesn&apos;t exist, or it moved.
        </p>
        <Link
          href="/"
          className="mt-8 inline-block text-sm text-forest underline underline-offset-2"
        >
          Back to the start
        </Link>
      </div>
    </div>
  );
}
