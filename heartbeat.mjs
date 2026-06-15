// Daily "still alive" digest. Reads the latest prices + run freshness from
// Supabase and emails a summary, so you know the watcher is running even when
// nothing has triggered an alert. Run by .github/workflows/heartbeat.yml.

import { join } from "path";
import { sendEmail } from "./notify.mjs";
import { usd } from "./parse.mjs";

try { process.loadEnvFile(join(process.cwd(), ".env")); } catch { /* no .env */ }

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_KEY;
if (!URL || !KEY) { console.error("SUPABASE_URL/KEY required"); process.exit(1); }

const h = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const get = async (path) => {
  const r = await fetch(`${URL}/rest/v1/${path}`, { headers: h });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
};

const latest = await get("stubhub_latest_prices?select=*&order=min_price.asc");
const dayAgo = new Date(Date.now() - 864e5).toISOString();
// One row per run for a single stable class -> counts successful runs in 24h.
const runs = await get(
  `stubhub_price_snapshots?select=captured_at&class_name=eq.Upper%20300-Level&captured_at=gte.${dayAgo}`
);

const lastRun = latest.length
  ? new Date(Math.max(...latest.map((r) => +new Date(r.captured_at)))).toUTCString()
  : "never";

const lines = [];
lines.push(`The StubHub watcher is running.`);
lines.push(`Successful checks in the last 24 hours: ${runs.length}`);
lines.push(`Most recent check: ${lastRun}`);
lines.push("");
lines.push("Current cheapest per ticket class (per ticket, all-in):");
for (const r of latest)
  lines.push(`  ${r.class_name.padEnd(18)} ${usd(r.min_price).padStart(8)}/tkt  (${r.listings} listings)`);
lines.push("");
lines.push("https://www.stubhub.com/world-cup-seattle-tickets-6-19-2026/event/153020544/?quantity=2");
const text = lines.join("\n");

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const html = [
  `<p><b>The StubHub watcher is running.</b></p>`,
  `<p>Successful checks in the last 24 hours: <b>${runs.length}</b><br>Most recent check: ${esc(lastRun)}</p>`,
  `<table cellpadding="6" style="border-collapse:collapse">`,
  `<tr><th align="left">Class</th><th align="right">From /tkt</th><th align="right">Listings</th></tr>`,
  ...latest.map((r) => `<tr><td>${esc(r.class_name)}</td><td align="right">${usd(r.min_price)}</td><td align="right">${r.listings}</td></tr>`),
  `</table>`,
].join("\n");

const r = await sendEmail({ subject: "StubHub watcher — daily heartbeat", text, html });
console.log(`heartbeat sent ${r.dryRun ? "(DRY RUN)" : "id=" + (r.id || "?")}; runs7d=${runs.length}, classes=${latest.length}`);
