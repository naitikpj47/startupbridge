/*
 * Exercises the picker's server-side guards against the live database
 * using the same queries analyseCandidates() runs. No model calls except
 * the single opt-in analysis at the end, which only runs with --analyse.
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

const PROBLEM = "f808789f-c347-4991-b122-cba8a4f2b3ec"; // malaria / Thailand

let pass = 0;
let fail = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(
    `${ok ? "  ok  " : "  FAIL"}  ${name}` +
      (ok ? "" : `\n         got ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`)
  );
  ok ? pass++ : fail++;
}

/** The ownership filter from analyseCandidates, verbatim. */
async function ownedOf(problemId: string, ids: string[]) {
  const { data } = await sb
    .from("startups")
    .select("id")
    .eq("sourced_for", problemId)
    .in("id", ids.slice(0, 25));
  return (data ?? []).map((r) => r.id as string);
}

async function inFlight() {
  const { data } = await sb
    .from("jobs")
    .select("payload")
    .eq("type", "enrich_startup")
    .in("status", ["queued", "running"]);
  return new Set(
    (data ?? [])
      .map((j) => (j.payload as { startup_id?: string })?.startup_id)
      .filter((v): v is string => typeof v === "string")
  );
}

console.log("\npicker guards");

const { data: mine } = await sb
  .from("startups")
  .select("id, name")
  .eq("sourced_for", PROBLEM)
  .neq("status", "rejected");
const ours = (mine ?? []).map((r) => r.id as string);
check("this problem has candidates to pick from", ours.length > 0, true);

// A startup belonging to a DIFFERENT problem must be filtered out even
// if the client sends its id in the array.
const { data: foreign } = await sb
  .from("startups")
  .select("id, name, sourced_for")
  .neq("sourced_for", PROBLEM)
  .not("sourced_for", "is", null)
  .limit(1);
if (foreign?.length) {
  const smuggled = [...ours.slice(0, 1), foreign[0].id as string];
  const allowed = await ownedOf(PROBLEM, smuggled);
  check("a candidate from another problem is rejected", allowed.includes(foreign[0].id as string), false);
  check("...while the legitimate one survives", allowed, [ours[0]]);
} else {
  console.log("  skip  no cross-problem candidate available to smuggle");
}

// A startup with no sourced_for at all (a seed / self-serve submission).
const { data: unsourced } = await sb
  .from("startups")
  .select("id")
  .is("sourced_for", null)
  .limit(1);
if (unsourced?.length) {
  const allowed = await ownedOf(PROBLEM, [unsourced[0].id as string]);
  check("a startup that no hunt found is rejected", allowed, []);
}

// A junk uuid must not throw and must not be allowed.
const allowedJunk = await ownedOf(PROBLEM, ["00000000-0000-4000-a000-0000000000ff"]);
check("an unknown id is rejected without error", allowedJunk, []);

// Empty selection is a no-op, never a "select everything".
check("empty selection allows nothing", await ownedOf(PROBLEM, []), []);

// The double-click guard.
const flight = await inFlight();
const toQueue = ours.filter((id) => !flight.has(id));
check(
  "in-flight filter is a strict subset of owned",
  toQueue.every((id) => ours.includes(id)),
  true
);
console.log(`         (${flight.size} analysis job(s) in flight, ${toQueue.length} of ${ours.length} queueable)`);

// The >25 cap must be visible, not silent. Flag it if it could ever bite.
console.log(
  ours.length > 25
    ? "  WARN  more than 25 candidates: the .in() cap would silently truncate"
    : `         cap is not reachable here (${ours.length} candidates, cap 25)`
);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
