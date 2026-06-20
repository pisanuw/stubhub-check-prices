// Daily "still alive" digest. For every enabled event (events.json) it reads
// the latest prices + run freshness from Supabase and emails a per-event
// summary, so you know the watcher is running even when nothing has triggered
// an alert. Run by .github/workflows/heartbeat.yml.
//
// The heartbeat intentionally reports ALL ticket classes (it ignores
// ALERTS.ignoreClasses, which only affects alerting in scrape.mjs).

import { join } from "path";
import { sendEmail } from "./notify.mjs";
import { usd } from "./parse.mjs";
import { ENABLED_EVENTS } from "./config.mjs";
import { latestByClass, runCount, usingSupabase } from "./store.mjs";

try { process.loadEnvFile(join(process.cwd(), ".env")); } catch { /* no .env */ }

if (!usingSupabase()) {
  console.error("STUBHUB_SUPABASE_URL/KEY required");
  process.exit(1);
}
if (!ENABLED_EVENTS.length) {
  console.error("no enabled events in events.json");
  process.exit(1);
}

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

const textBlocks = [];
const htmlBlocks = [`<p><b>The StubHub watcher is running.</b></p>`];
let totalRuns = 0;

for (const ev of ENABLED_EVENTS) {
  const [latest, runs] = await Promise.all([
    latestByClass(ev.id),
    runCount(ev.id),
  ]);
  totalRuns += runs.count;
  const lastRun = runs.last ? new Date(runs.last).toUTCString() : "never";

  const tlines = [];
  tlines.push(ev.label || ev.id);
  tlines.push(`  Successful checks in the last 24 hours: ${runs.count}`);
  tlines.push(`  Most recent check: ${lastRun}`);
  if (latest.length) {
    tlines.push("  Current cheapest per ticket class (per ticket, all-in):");
    for (const r of latest)
      tlines.push(`    ${r.class_name.padEnd(18)} ${usd(r.min_price).padStart(8)}/tkt  (${r.listings} listings)`);
  } else {
    tlines.push("  (no recent price rows)");
  }
  tlines.push(`  ${ev.url}`);
  textBlocks.push(tlines.join("\n"));

  htmlBlocks.push(
    `<h3>${esc(ev.label || ev.id)}</h3>`,
    `<p>Successful checks in the last 24 hours: <b>${runs.count}</b><br>Most recent check: ${esc(lastRun)}</p>`,
    `<table cellpadding="6" style="border-collapse:collapse">`,
    `<tr><th align="left">Class</th><th align="right">From /tkt</th><th align="right">Listings</th></tr>`,
    ...latest.map((r) => `<tr><td>${esc(r.class_name)}</td><td align="right">${usd(r.min_price)}</td><td align="right">${r.listings}</td></tr>`),
    `</table>`,
    `<p><a href="${esc(ev.url)}">View on StubHub</a></p>`
  );
}

const text = ["The StubHub watcher is running.", "", ...textBlocks].join("\n\n");
const html = htmlBlocks.join("\n");

const r = await sendEmail({ subject: "StubHub watcher - daily heartbeat", text, html });
console.log(`heartbeat sent ${r.dryRun ? "(DRY RUN)" : "id=" + (r.id || "?")}; events=${ENABLED_EVENTS.length}, totalRuns24h=${totalRuns}`);
