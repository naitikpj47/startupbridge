import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { allowRequest, WORKER_TICK_LIMIT } from "@/lib/server/rateLimit";
import { runWorker } from "@/lib/jobs";

/** Queued jobs run here — a dedicated worker invocation, not a data
 * route: it takes no input, returns no data, and just drains a small
 * batch. The intake UI kicks it after enqueueing; scheduled automation
 * (Phase 6) can hit it too. */
export const maxDuration = 60;

let draining = false;

export async function POST(request: Request) {
  if (!(await allowRequest(request, WORKER_TICK_LIMIT))) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }
  if (draining) return NextResponse.json({ status: "already-running" });

  draining = true;
  try {
    const sb = createSupabaseAdminClient();
    // Bounded drain: at most 3 jobs per tick keeps well inside the
    // function budget; anything left is picked up by the next tick.
    await runWorker(sb, { drain: true, maxJobs: 3, waitForBackoff: false });
    return NextResponse.json({ status: "ok" });
  } finally {
    draining = false;
  }
}
