/**
 * Standalone queue worker. Drains and exits by default.
 *
 *   npx tsx scripts/worker.ts             # drain everything, then exit
 *   npx tsx scripts/worker.ts --watch     # keep polling
 *   npx tsx scripts/worker.ts --max 1     # process at most N jobs
 *
 * --max is the spend control: AI jobs cost money, so cap the batch when
 * you want to inspect results before letting the rest run.
 */
import { loadEnvLocal, scriptAdminClient } from "./script-utils";
import { runWorker } from "../src/lib/jobs";

loadEnvLocal();

const args = process.argv.slice(2);
const watch = args.includes("--watch");
const maxIdx = args.indexOf("--max");
const maxJobs = maxIdx !== -1 ? Number(args[maxIdx + 1]) : undefined;

if (maxIdx !== -1 && (!Number.isFinite(maxJobs) || maxJobs! < 1)) {
  console.error("--max needs a positive number");
  process.exit(1);
}

runWorker(scriptAdminClient(), {
  drain: !watch,
  maxJobs,
  onJob: (job, ok, err) =>
    console.log(
      `${new Date().toISOString()} ${ok ? "ok  " : "FAIL"} ${job.type} ${JSON.stringify(job.payload)}${err ? ` — ${err}` : ""}`
    ),
})
  .then((r) => console.log(`Worker done: ${r.succeeded} ok, ${r.failed} failed`))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
