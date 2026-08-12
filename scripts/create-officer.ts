/**
 * Bootstrap (or reset) the program-officer account: creates a Supabase
 * Auth user for every email in DASHBOARD_ALLOWLIST_EMAILS with a fresh
 * random password, printed ONCE to the terminal. The DB-side allowlist
 * (team_members) already gates what the account can read.
 *
 *   npx tsx scripts/create-officer.ts
 */
import { randomBytes } from "node:crypto";
import { loadEnvLocal, scriptAdminClient } from "./script-utils";

loadEnvLocal();

async function main() {
  const emails = (process.env.DASHBOARD_ALLOWLIST_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (!emails.length) throw new Error("DASHBOARD_ALLOWLIST_EMAILS is empty");

  const sb = scriptAdminClient();

  for (const email of emails) {
    const password = randomBytes(12).toString("base64url");

    // Ensure the DB allowlist row exists (idempotent).
    await sb.from("team_members").upsert({ email }, { onConflict: "email" });

    const { data: existing } = await sb.auth.admin.listUsers();
    const user = existing?.users.find(
      (u) => u.email?.toLowerCase() === email
    );

    if (user) {
      const { error } = await sb.auth.admin.updateUserById(user.id, { password });
      if (error) throw new Error(`reset ${email}: ${error.message}`);
      console.log(`RESET    ${email}  password: ${password}`);
    } else {
      const { error } = await sb.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error) throw new Error(`create ${email}: ${error.message}`);
      console.log(`CREATED  ${email}  password: ${password}`);
    }
  }
  console.log(
    "\nStore the password somewhere safe — it is not saved anywhere else.\n" +
      "Re-running this script resets it."
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
