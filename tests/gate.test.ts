/* Deterministic tests for the sufficiency gate. No model calls, no cost. */
import { checkSufficiency, unansweredDimensions, DIMENSIONS } from "../src/lib/intake-shared";
import type { IntakeAnswer, DimensionKey } from "../src/lib/intake-shared";

let pass = 0;
let fail = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}${ok ? "" : `\n         got ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
}

const ALL: DimensionKey[] = DIMENSIONS.map((d) => d.key);
const build = (
  filled: Partial<Record<DimensionKey, string>>,
  unknowns: DimensionKey[] = []
): IntakeAnswer[] =>
  ALL.map((key) => ({
    key,
    value: filled[key] ?? "",
    unknown: unknowns.includes(key),
  }));

console.log("\nsufficiency gate");

// The exact case that used to produce five fabricated sentences.
check(
  "topic + place alone is blocked",
  checkSufficiency(build({ problem: "decrease malaria", where: "Thailand" })).ok,
  false
);
check(
  "and the message says why",
  checkSufficiency(build({ problem: "decrease malaria", where: "Thailand" })).message.startsWith(
    "That's a topic and a place"
  ),
  true
);

// One lived detail opens it.
check(
  "one lived detail opens the gate",
  checkSufficiency(
    build({ problem: "undetected cases", where: "Thailand", who: "migrant workers" })
  ).ok,
  true
);
for (const k of ["today", "constraints", "success"] as DimensionKey[]) {
  check(
    `...and so does '${k}' alone`,
    checkSufficiency(build({ problem: "undetected cases", where: "Thailand", [k]: "a real detail" })).ok,
    true
  );
}

// The two required dimensions really are required.
check(
  "no problem statement -> blocked",
  checkSufficiency(build({ where: "Thailand", who: "migrant workers" })).ok,
  false
);
check(
  "no location -> blocked",
  checkSufficiency(build({ problem: "undetected cases", who: "migrant workers" })).ok,
  false
);

// "I don't know" must never count as an answer.
check(
  "unknown does not satisfy a dimension",
  checkSufficiency(
    build({ problem: "p", where: "w" }, ["who", "today", "constraints", "success"])
  ).ok,
  false
);
check(
  "unknown with text present still does not count",
  checkSufficiency([
    { key: "problem", value: "undetected cases", unknown: false },
    { key: "where", value: "Thailand", unknown: false },
    { key: "who", value: "migrant workers", unknown: true },
    { key: "today", value: "", unknown: false },
    { key: "constraints", value: "", unknown: false },
    { key: "success", value: "", unknown: false },
  ]).ok,
  false
);

// Whitespace / stub answers must not clear the bar.
check(
  "whitespace is not an answer",
  checkSufficiency(build({ problem: "undetected cases", where: "Thailand", who: "   " })).ok,
  false
);
check(
  "a single character is not an answer",
  checkSufficiency(build({ problem: "undetected cases", where: "Thailand", who: "x" })).ok,
  false
);

// A missing dimension entry is treated the same as unanswered.
check(
  "absent dimension is not silently counted",
  checkSufficiency([
    { key: "problem", value: "undetected cases", unknown: false },
    { key: "where", value: "Thailand", unknown: false },
  ]).ok,
  false
);

// Everything answered.
const full = checkSufficiency(
  build({
    problem: "undetected cases",
    where: "border provinces",
    who: "migrant workers",
    today: "fixed clinics",
    constraints: "no mains power",
    success: "earlier detection",
  })
);
check("all six -> ok", full.ok, true);
check("all six -> nothing missing", full.missing, []);
check("all six -> precise message", full.message, "Everything's covered — this will be a precise brief.");

// Partial: gaps are counted honestly, not hidden.
const partial = checkSufficiency(
  build({ problem: "undetected cases", where: "Thailand", who: "migrant workers" })
);
check("partial -> 3 gaps named", partial.missing, ["today", "constraints", "success"]);
check("partial -> confirmed lists exactly the three", partial.confirmed, ["problem", "where", "who"]);
check(
  "partial -> message admits the gaps",
  partial.message.includes("3 areas will be written up as an open question"),
  true
);

// The blocking list must never name a dimension that IS filled.
const b = checkSufficiency(build({ problem: "undetected cases", where: "Thailand" }));
check(
  "blocking never names a filled dimension",
  b.blocking.some((k) => ["problem", "where"].includes(k)),
  false
);

// Regression: the gate blocks emptiness, not brevity. "UK" is an answer.
check(
  "a two-letter country is a valid answer",
  checkSufficiency(build({ problem: "undetected cases", where: "UK" })).blocking.includes("where"),
  false
);

console.log("\nunanswered dimensions (what the draft is told is missing)");

// The bug this covers: pressing "Next" leaves {value:"", unknown:false},
// which is neither an answer nor a declared unknown. Counting only the
// declared unknowns made those questions vanish, and the draft prompt
// then said "Nothing is missing" about things nobody had answered.
check(
  "a question skipped with Next is still a gap",
  unansweredDimensions(
    build({ problem: "undetected cases", where: "Thailand", who: "migrant workers" })
  ),
  ["today", "constraints", "success"]
);
check(
  "a declared unknown is a gap",
  unansweredDimensions(
    build({ problem: "undetected cases", where: "Thailand", who: "migrant workers" }, ["today"])
  ).includes("today"),
  true
);
check(
  "a dimension absent from the array is a gap",
  unansweredDimensions([
    { key: "problem", value: "undetected cases", unknown: false },
    { key: "where", value: "Thailand", unknown: false },
  ]).length,
  4
);
check(
  "an answered dimension is never a gap",
  unansweredDimensions(
    build({ problem: "undetected cases", where: "Thailand", who: "migrant workers" })
  ).includes("who"),
  false
);
check(
  "all six answered -> no gaps at all",
  unansweredDimensions(
    build({
      problem: "undetected cases",
      where: "Thailand",
      who: "migrant workers",
      today: "fixed clinics",
      constraints: "no mains power",
      success: "earlier detection",
    })
  ),
  []
);
check(
  "gaps agree with the gate's own missing list",
  unansweredDimensions(
    build({ problem: "undetected cases", where: "Thailand", who: "migrant workers" })
  ),
  checkSufficiency(
    build({ problem: "undetected cases", where: "Thailand", who: "migrant workers" })
  ).missing
);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
