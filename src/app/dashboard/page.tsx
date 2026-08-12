import { requireOfficer } from "@/lib/server/auth";
import { AskBox } from "./ask-client";

export const dynamic = "force-dynamic";

/**
 * The Ask runs four sequential calls (structure, brief, embed, match),
 * ~25s in practice. Hosts default to a 10s function budget, which kills
 * it mid-flight and surfaces as an opaque server error — so ask for the
 * full minute explicitly. Server actions invoked from this page inherit
 * this budget.
 */
export const maxDuration = 60;

/**
 * The whole point of the dashboard: one question, nothing competing with
 * it. Counts, queues, and archives live behind the sidebar.
 */
export default async function DashboardHome() {
  await requireOfficer();
  return (
    <div className="flex min-h-[70vh] flex-col justify-center">
      <AskBox />
    </div>
  );
}
