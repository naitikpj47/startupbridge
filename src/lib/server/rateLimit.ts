import "server-only";
import { createHash } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/** Public intake surfaces share one bucket: 5 per IP per hour (spec +
 * patch 9). Worker ticks get their own, looser bucket. */
export const PUBLIC_INTAKE_LIMIT = { bucket: "public_intake", limit: 5, windowSeconds: 3600 };
// The Ask polls every 5s and re-kicks the worker while a hunt is queued,
// so this needs headroom — it is a drain trigger, not a data endpoint.
export const WORKER_TICK_LIMIT = { bucket: "worker_tick", limit: 300, windowSeconds: 3600 };

export function clientIpHash(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || "local";
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

/** True when the request is allowed; false when rate-limited. */
export async function allowRequest(
  request: Request,
  opts: { bucket: string; limit: number; windowSeconds: number }
): Promise<boolean> {
  const sb = createSupabaseAdminClient();
  const { data, error } = await sb.rpc("check_rate_limit", {
    p_bucket: opts.bucket,
    p_ip_hash: clientIpHash(request),
    p_limit: opts.limit,
    p_window_seconds: opts.windowSeconds,
  });
  if (error) {
    // Fail closed on the public surface.
    console.error(`check_rate_limit failed: ${error.message}`);
    return false;
  }
  return data === true;
}
