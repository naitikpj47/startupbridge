/**
 * Server-side environment access. Fails loudly with the variable name so a
 * missing key is diagnosed in seconds, not silently undefined at runtime.
 *
 * Do not use for NEXT_PUBLIC_* values in client components — those must be
 * referenced statically (process.env.NEXT_PUBLIC_X) so Next.js can inline
 * them at build time.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Add it to .env.local (see .env.example).`
    );
  }
  return value;
}
