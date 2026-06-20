// Main run: for each enabled event (events.json), load the event page once,
// parse the embedded data, append a snapshot to history, run alerting, and log
// a human summary.
//
//   npm run scrape            # headless, all enabled events
//   HEADLESS=0 npm run scrape # visible browser (use if challenged)

import { chromium } from "playwright";
import { readFile, writeFile, appendFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { buildSnapshot, buildCategories } from "./parse.mjs";
import { evaluate, renderEmail } from "./alert.mjs";
import { sendEmail } from "./notify.mjs";
import { loadState, saveState, saveClassSnapshots, usingSupabase } from "./store.mjs";
import {
  ROOT, ENABLED_EVENTS, PROFILE_DIR, CSV_PATH, LOG_PATH, HEADLESS, FILTER, ALERTS,
} from "./config.mjs";

// Load .env (RESEND_API_KEY, FROM_EMAIL, ADMIN_EMAIL, STUBHUB_SUPABASE_*) if present.
try { process.loadEnvFile(join(ROOT, ".env")); } catch { /* no .env */ }

const SECTIONS_CSV = join(ROOT, "sections.csv");
const SECTION_NAMES_CACHE = join(ROOT, "section-names.json");

function log(line) {
  const msg = `${new Date().toISOString()}  ${line}`;
  console.log(msg);
  return appendFile(LOG_PATH, msg + "\n");
}

function csvCell(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
async function appendCsv(path, header, rows) {
  if (!existsSync(path)) await writeFile(path, header.join(",") + "\n");
  const body = rows.map((r) => r.map(csvCell).join(",")).join("\n");
  if (body) await appendFile(path, body + "\n");
}

// Does a class summary match the user's watch filter?
function classMatches(c) {
  if (FILTER.sections?.length || FILTER.zones?.length) {
    const hay = c.className.toLowerCase();
    const wanted = [...(FILTER.sections || []), ...(FILTER.zones || [])];
    if (!wanted.some((w) => hay.includes(String(w).toLowerCase()))) return false;
  }
  if (FILTER.maxPrice != null && c.rawMinPrice > FILTER.maxPrice) return false;
  return true;
}

// Process one event: navigate, parse, persist, alert, summarize.
async function processEvent(page, ev) {
  const stamp = new Date().toISOString();
  await log(`---- ${ev.label || ev.id} (${ev.url}) ----`);

  const resp = await page.goto(ev.url, { waitUntil: "domcontentloaded", timeout: 60000 });
  const html = (await resp.text()) || (await page.content());
  const snap = buildSnapshot(html, stamp);
  const eventId = String(snap.eventId ?? ev.id);
  snap.eventUrl = ev.url;

  // Merge & persist learned sectionId -> name map, namespaced per event.
  let cache = {};
  if (existsSync(SECTION_NAMES_CACHE))
    cache = JSON.parse(await readFile(SECTION_NAMES_CACHE, "utf8"));
  cache[eventId] = { ...(cache[eventId] || {}), ...snap.sectionNames };
  await writeFile(SECTION_NAMES_CACHE, JSON.stringify(cache, null, 0));
  snap.sections.forEach((s) => { if (!s.section) s.section = cache[eventId][s.sectionId] || ""; });

  const qty = snap.quantity ?? FILTER.quantity ?? 2;

  // ---- per-class price history (Supabase in cloud, CSV locally) ----
  await saveClassSnapshots(
    snap.classes.map((c) => ({
      captured_at: snap.time, event_id: eventId, ticket_class_id: c.ticketClassId,
      class_name: c.className, min_price: c.rawMinPrice,
      total_for_qty: +(c.rawMinPrice * qty).toFixed(2), qty, listings: c.listings, tickets: c.tickets,
    })),
    { csvPath: CSV_PATH }
  );

  // ---- per-section CSV (finer detail, local only) ----
  if (!usingSupabase()) {
    await appendCsv(
      SECTIONS_CSV,
      ["time", "eventId", "ticketClassId", "className", "sectionId", "section", "minPricePerTicket", "listings", "tickets", "row", "cheapestListingId"],
      snap.sections.map((s) => [
        snap.time, eventId, s.ticketClassId, s.className, s.sectionId, s.section,
        s.rawMinPrice, s.listings, s.tickets, s.rowText, s.cheapestListingId,
      ])
    );
  }

  // ---- alerting (per event: 20% drop vs previous reading, or new category) ----
  if (ALERTS.enabled) {
    try {
      const stateKey = `alert-state:${eventId}`;
      const stateFile = join(ROOT, `alert-state.${eventId}.json`);
      const kinds = new Set(ALERTS.kinds || ["class", "section", "watch"]);
      const ignore = new Set((ALERTS.ignoreClasses || []).map((s) => s.toLowerCase()));
      const categories = buildCategories(snap, ALERTS.watchTerms)
        .filter((c) => kinds.has(c.kind))
        .filter((c) => !(c.cls && ignore.has(c.cls.toLowerCase())));
      const state = await loadState({ stateFile, key: stateKey });
      const firstRun = !state.initialized;
      const events = evaluate(state, categories, {
        dropThreshold: ALERTS.dropThreshold,
        rearmRecovery: ALERTS.rearmRecovery,
        time: snap.time,
      });
      await saveState(state, { stateFile, key: stateKey });

      if (firstRun) {
        await log(`  alerts: baseline established for ${categories.length} categories (no email on first run)`);
      } else if (events.length) {
        const { subject, text, html } = renderEmail(events, snap);
        const r = await sendEmail({ subject, text, html });
        await log(`  alerts: ${events.length} event(s) -> email ${r.dryRun ? "(DRY RUN)" : "sent id=" + (r.id || "?")}`);
        for (const e of events)
          await log(`    - ${e.type.toUpperCase()} ${e.label}${e.type === "drop" ? ` -${e.pct}%` : ""}`);
      } else {
        await log(`  alerts: no triggers (${categories.length} categories checked)`);
      }
    } catch (e) {
      await log(`  alerts: ERROR ${e.message}`);
    }
  }

  // ---- human summary ----
  await log(`OK ${snap.eventName} | ${snap.totalListings} listings | overall from ${snap.overallMinPrice}`);
  const matches = snap.classes.filter(classMatches);
  const watching = FILTER.maxPrice != null || FILTER.sections?.length || FILTER.zones?.length;
  if (watching) {
    if (matches.length) {
      for (const c of matches)
        await log(`  >> MATCH ${c.className}: from ${c.formattedMinPrice}/tkt (${c.listings} listings)`);
    } else {
      await log("  (no listings match the watch filter right now)");
    }
  } else {
    for (const c of snap.classes)
      await log(`  ${c.className.padEnd(18)} from ${c.formattedMinPrice}/tkt  (${c.listings} listings, ${c.tickets} tkts)`);
  }
}

async function main() {
  if (!ENABLED_EVENTS.length) { await log("no enabled events in events.json; nothing to do"); return; }

  // Locally we drive real Google Chrome (channel "chrome"). In CI set
  // CHROME_CHANNEL=chromium to use Playwright's bundled Chromium instead.
  const channel = process.env.CHROME_CHANNEL || "chrome";
  const launchOpts = { headless: HEADLESS, viewport: { width: 1400, height: 950 } };
  if (channel !== "chromium") launchOpts.channel = channel;
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, launchOpts);
  let failures = 0;
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    for (const ev of ENABLED_EVENTS) {
      try {
        await processEvent(page, ev);
      } catch (e) {
        failures++;
        await log(`ERROR event ${ev.id} (${ev.label || ""}): ${e.message}`);
      }
    }
  } finally {
    await ctx.close();
  }
  if (failures) throw new Error(`${failures} of ${ENABLED_EVENTS.length} event(s) failed`);
}

main().then(
  () => process.exit(0),
  async (e) => { await log(`ERROR ${e.message}`); process.exit(1); }
);
