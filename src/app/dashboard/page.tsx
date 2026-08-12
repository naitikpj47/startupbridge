import { requireOfficer } from "@/lib/server/auth";
import { AskBox } from "./ask-client";

export const dynamic = "force-dynamic";

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
