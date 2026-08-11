/**
 * Standalone queue worker. Drains and exits by default; --watch polls
 * continuously (used later by scheduled automation).
 *
 *   npx tsx scripts/worker.ts [--watch]
 */
import { loadEnvLocal, scriptAdminClient } from "./script-utils";
import { runWorker } from "../src/lib/jobs";

loadEnvLocal();

const watch = process.argv.includes("--watch");

runWorker(scriptAdminClient(), {
  drain: !watch,
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
