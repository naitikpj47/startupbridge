/**
 * One mark per intake dimension. Drawn rather than emoji so they sit at
 * the same weight as the hairline borders and inherit ink colour — the
 * rail should read as part of the page, not stuck onto it.
 */

const PATHS: Record<string, React.ReactNode> = {
  // problem — a target
  target: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" />
    </>
  ),
  // where — a map pin
  pin: (
    <>
      <path d="M12 21.5s7-6.2 7-11.2a7 7 0 1 0-14 0c0 5 7 11.2 7 11.2Z" />
      <circle cx="12" cy="10" r="2.6" />
    </>
  ),
  // who — two figures
  people: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M2.8 20.5a6.2 6.2 0 0 1 12.4 0" />
      <path d="M16.2 5.4a3.2 3.2 0 0 1 0 5.9M17.6 14.9a6.2 6.2 0 0 1 3.6 5.6" />
    </>
  ),
  // today — a loop that doesn't close
  cycle: (
    <>
      <path d="M20 12a8 8 0 1 1-2.9-6.2" />
      <path d="M20.4 3.6v4.6h-4.6" />
      <path d="m9.6 11.4 2.4 2.4 3.4-4" />
    </>
  ),
  // constraints — a shield
  shield: (
    <>
      <path d="M12 2.6 4.5 5.8v5.5c0 4.6 3.1 8.6 7.5 10.1 4.4-1.5 7.5-5.5 7.5-10.1V5.8Z" />
      <path d="M12 8.6v4.2" />
      <path d="M12 16.2h.01" />
    </>
  ),
  // success — a flag
  flag: (
    <>
      <path d="M5.5 21.5V3.2" />
      <path d="M5.5 4.2h11l-2.2 4 2.2 4h-11" />
    </>
  ),
};

export function DimensionIcon({
  name,
  className = "h-4 w-4",
}: {
  name: string;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {PATHS[name] ?? PATHS.target}
    </svg>
  );
}

/** Small tick used on answered rail rows. */
export function Tick({ className = "h-3 w-3" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="m4 12.5 5.5 5.5L20 6.5" />
    </svg>
  );
}

/** Shown on dimensions the officer marked unknown — an honest gap. */
export function Gap({ className = "h-3 w-3" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M5 12h14" strokeDasharray="3 3.5" />
    </svg>
  );
}
