// One-off password set (not committed with a value; takes it from argv).
import { loadEnvLocal, scriptAdminClient } from "./script-utils";
loadEnvLocal();
async function main() {
  const [email, password] = process.argv.slice(2);
  if (!email || !password) throw new Error("usage: set-password <email> <password>");
  const sb = scriptAdminClient();
  const { data } = await sb.auth.admin.listUsers();
  const user = data?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) throw new Error(`no auth user for ${email}`);
  const { error } = await sb.auth.admin.updateUserById(user.id, { password });
  if (error) throw new Error(error.message);
  console.log(`password updated for ${email}`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
