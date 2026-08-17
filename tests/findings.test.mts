/*
 * Reproduces huntFindings()'s derivation exactly, to confirm the fixed
 * `analysed` / `failed` flags describe reality. No model calls.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const PROBLEM = "f808789f-c347-4991-b122-cba8a4f2b3ec";

// Concatenated select strings defeat supabase-js's literal type parser,
// exactly as they do in huntFindings — same cast, same reason.
const { data: rawRows } = await sb
  .from("startups")
  .select(
    "id, name, domain, website, status, created_at, " +
      "startup_profiles(base_readiness, data_confidence, poc_evidence, " +
      "hq_country, poc_status, infra_intensity, sectors)"
  )
  .eq("sourced_for", PROBLEM)
  .neq("status", "rejected")
  .order("created_at", { ascending: false });
const rows = (rawRows ?? []) as unknown as {
  id: string;
  name: string;
  startup_profiles: Record<string, unknown> | Record<string, unknown>[] | null;
}[];

const { data: jobRows } = await sb
  .from("jobs")
  .select("payload, status, error, created_at")
  .eq("type", "enrich_startup")
  .in("status", ["queued", "running", "failed"])
  .order("created_at", { ascending: false });

const inFlight = new Set<string>();
const lastFailure = new Map<string, string>();
for (const j of jobRows ?? []) {
  const sid = (j.payload as { startup_id?: string })?.startup_id;
  if (typeof sid !== "string") continue;
  if (j.status === "failed") {
    if (!lastFailure.has(sid)) lastFailure.set(sid, (j.error as string) ?? "unknown error");
  } else inFlight.add(sid);
}

const { data: sims } = await sb.rpc("problem_similarities", { p_problem_id: PROBLEM });
const simBy = new Map(
  (sims as { startup_id: string; similarity: number }[]).map((s) => [s.startup_id, s.similarity])
);

let pass = 0,
  fail = 0;
const check = (n: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${n}${ok ? "" : `  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);
  ok ? pass++ : fail++;
};

console.log("\nfindings view");
const view = rows.map((r) => {
  const p = (Array.isArray(r.startup_profiles) ? r.startup_profiles[0] : r.startup_profiles) as
    | Record<string, unknown>
    | null;
  // Mirrors huntFindings: analysed means embedded, and the similarity
  // RPC returns exactly the embedded rows. profile_text was the previous
  // marker and this suite is what proved it wrong — any recompute (e.g.
  // the pg_cron sweep) rebuilds it without a site ever being fetched.
  const analysed = simBy.has(r.id);
  const pending = inFlight.has(r.id);
  return {
    name: r.name,
    analysed,
    pending,
    failed: analysed || pending ? null : lastFailure.get(r.id) ?? null,
    readiness: (p?.base_readiness as number | null) ?? null,
    similarity: simBy.get(r.id) ?? null,
    selectable: !analysed && !pending,
  };
});

for (const f of view) {
  console.log(
    `  ${f.name.padEnd(26)} analysed=${String(f.analysed).padEnd(5)} pending=${String(f.pending).padEnd(5)} ` +
      `sim=${f.similarity ? f.similarity.toFixed(3) : "—"} readiness=${f.readiness ?? "—"} ` +
      `${f.failed ? `failed="${f.failed}"` : ""}`
  );
}

const accessBio = view.find((f) => f.name === "Access Bio")!;
check("an analysed candidate reports analysed=true", accessBio.analysed, true);
check("...even though its readiness is legitimately NULL", accessBio.readiness, null);
check("...and it is no longer offered for a repeat paid run", accessBio.selectable, false);
check("...and carries a real similarity", accessBio.similarity !== null, true);

const pocdoc = view.find((f) => f.name === "PocDoc")!;
check(
  "a candidate whose site failed is either pending a retry or reports the failure",
  pocdoc.pending || pocdoc.failed !== null,
  true
);

check(
  "no candidate is both analysed and pending",
  view.some((f) => f.analysed && f.pending),
  false
);
check(
  "no candidate reports a failure while analysed",
  view.some((f) => f.analysed && f.failed),
  false
);
check(
  "untouched candidates are still selectable",
  view.filter((f) => f.selectable).length > 0,
  true
);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
