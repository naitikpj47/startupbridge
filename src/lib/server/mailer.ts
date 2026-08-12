import "server-only";

/**
 * Claim-code delivery. With RESEND_API_KEY + EMAIL_FROM configured the
 * code goes out by email; without them (local development) the code is
 * printed to the server log so the flow stays testable end to end.
 */
export async function sendClaimCode(to: string, code: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    console.log(`[claim-code] (no email provider configured) code for ${to}: ${code}`);
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject: "Your verification code",
      text:
        `Your verification code is: ${code}\n\n` +
        `It expires in 15 minutes. If you did not request this, ignore this email.`,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`Email send failed: HTTP ${res.status}`);
  }
}
