// Sends email via Resend. Reads RESEND_API_KEY / FROM_EMAIL / ADMIN_EMAIL from
// the environment (loaded from .env by scrape.mjs). Set ALERT_DRYRUN=1 to print
// the message instead of sending.

export async function sendEmail({ subject, text, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.FROM_EMAIL;
  const to = process.env.ADMIN_EMAIL;

  if (process.env.ALERT_DRYRUN === "1") {
    return { dryRun: true, to, from, subject, text };
  }
  if (!apiKey || !from || !to)
    throw new Error("Missing RESEND_API_KEY / FROM_EMAIL / ADMIN_EMAIL in env");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, text, html: html || undefined }),
  });
  const bodyText = await res.text();
  if (!res.ok) throw new Error(`Resend ${res.status}: ${bodyText}`);
  return { id: JSON.parse(bodyText || "{}").id, to, from };
}
