/**
 * Add ONE officer without touching anyone else's account. Idempotent:
 * re-running updates the password for that email only.
 *
 *   npx tsx scripts/add-officer.ts <email> <password>
 *
 * (create-officer.ts resets EVERY allowlisted account's password — use
 * this when adding a colleague to a live system.)
 */
import { loadEnvLocal, scriptAdminClient } from "./script-utils";

loadEnvLocal();

async function main() {
  const [rawEmail, password] = process.argv.slice(2);
  if (!rawEmail || !password) {
    throw new Error("usage: add-officer <email> <password>");
  }
  const email = rawEmail.trim().toLowerCase();
  const sb = scriptAdminClient();

  // 1. The database allowlist — this is what RLS actually enforces.
  const { error: tErr } = await sb
    .from("team_members")
    .upsert({ email }, { onConflict: "email" });
  if (tErr) throw new Error(`team_members: ${tErr.message}`);

  // 2. The auth account.
  const { data: list } = await sb.auth.admin.listUsers();
  const existing = list?.users.find((u) => u.email?.toLowerCase() === email);

  if (existing) {
    const { error } = await sb.auth.admin.updateUserById(existing.id, { password });
    if (error) throw new Error(`update: ${error.message}`);
    console.log(`updated password for ${email}`);
  } else {
    const { error } = await sb.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw new Error(`create: ${error.message}`);
    console.log(`created ${email}`);
  }

  const { data: members } = await sb.from("team_members").select("email").order("email");
  console.log(`allowlist now: ${(members ?? []).map((m) => m.email).join(", ")}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
