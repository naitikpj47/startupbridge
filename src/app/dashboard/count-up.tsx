"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Animated count-up for scores: 0 → value over ~600ms, ease-out, then
 * still. Respects prefers-reduced-motion by rendering the final value
 * immediately. Tabular numerals mean the width never jitters.
 */
export function CountUp({
  value,
  className = "",
}: {
  value: number | null;
  className?: string;
}) {
  const [display, setDisplay] = useState(value ?? 0);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (value === null) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setDisplay(value);
      return;
    }
    const duration = 600;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setDisplay(Math.round(value * eased));
      if (t < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [value]);

  if (value === null) return <span className={className}>—</span>;
  return (
    <span className={className} aria-label={String(value)}>
      {display}
    </span>
  );
}
