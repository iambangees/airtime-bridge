/** Owner alerts via Resend (plain fetch, server-only). No-ops cleanly when
    RESEND_API_KEY / ALERT_EMAIL are not configured, so the app never breaks
    because alerting is off. With the default onboarding@resend.dev sender,
    Resend only delivers to the account owner's own inbox — which is exactly
    the alert recipient. */
export async function sendAlertEmail(subject: string, text: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.ALERT_EMAIL;
  if (!key || !to) return false;
  const from = process.env.RESEND_FROM || "Airtime Bridge <onboarding@resend.dev>";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, text }),
    });
    return res.ok;
  } catch { return false; }
}

/** Check the VTpass float and email the owner if it is below the threshold.
    Called from the daily cron sweep, so alerts arrive at most once a day. */
export async function checkFloatAndAlert(getBalance: () => Promise<number | null>): Promise<{ balance: number | null; alerted: boolean }> {
  const threshold = Number(process.env.LOW_BALANCE_THRESHOLD || 2000);
  const balance = await getBalance().catch(() => null);
  if (balance === null || balance >= threshold) return { balance, alerted: false };
  const alerted = await sendAlertEmail(
    `Airtime Bridge: VTpass float is low (₦${balance.toLocaleString("en-NG")})`,
    `Your VTpass wallet balance is ₦${balance.toLocaleString("en-NG")}, below the ₦${threshold.toLocaleString("en-NG")} alert threshold.\n\nTop up the VTpass wallet soon — if it empties, paid orders cannot be vended.\n\n— Airtime Bridge (automated check)`,
  );
  return { balance, alerted };
}
