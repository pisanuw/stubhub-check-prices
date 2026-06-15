// Main run: load the event page once, parse the embedded data, append a
// snapshot to the CSVs, and log a human summary (highlighting filter matches).
//
//   npm run scrape            # headless
//   HEADLESS=0 npm run scrape # visible browser (use if challenged)

import { chromium } from "playwright";
import { readFile, writeFile, appendFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { buildSnapshot, buildCategories } from "./parse.mjs";
import { evaluate, renderEmail } from "./alert.mjs";
import { sendEmail } from "./notify.mjs";
import {
  ROOT, EVENT_URL, PROFILE_DIR, CSV_PATH, LOG_PATH, HEADLESS, FILTER, ALERTS,
} from "./config.mjs";

// Load .env (RESEND_API_KEY, FROM_EMAIL, ADMIN_EMAIL) if present.
try { process.loadEnvFile(join(ROOT, ".env")); } catch { /* no .env */ }

const SECTIONS_CSV = join(ROOT, "sections.csv");
const SECTION_NAMES_CACHE = join(ROOT, "section-names.json");
const ALERT_STATE = join(ROOT, ALERTS.stateFile);

const now = new Date();
const stamp = now.toISOString();

function log(line) {
  const msg = `${stamp}  ${line}`;
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

async function main() {
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chrome",
    headless: HEADLESS,
    viewport: { width: 1400, height: 950 },
  });
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    const resp = await page.goto(EVENT_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    const html = (await resp.text()) || (await page.content());

    const snap = buildSnapshot(html, stamp);

    // Merge & persist learned sectionId -> name map.
    let cache = {};
    if (existsSync(SECTION_NAMES_CACHE))
      cache = JSON.parse(await readFile(SECTION_NAMES_CACHE, "utf8"));
    Object.assign(cache, snap.sectionNames);
    await writeFile(SECTION_NAMES_CACHE, JSON.stringify(cache, null, 0));
    snap.sections.forEach((s) => { if (!s.section) s.section = cache[s.sectionId] || ""; });

    const qty = snap.quantity ?? FILTER.quantity ?? 2;

    // ---- write per-class CSV (one row per ticket class per run) ----
    await appendCsv(
      CSV_PATH,
      ["time", "eventId", "ticketClassId", "className", "minPricePerTicket", "totalForQty", "qty", "listings", "tickets"],
      snap.classes.map((c) => [
        snap.time, snap.eventId, c.ticketClassId, c.className,
        c.rawMinPrice, +(c.rawMinPrice * qty).toFixed(2), qty, c.listings, c.tickets,
      ])
    );

    // ---- write per-section CSV (finer detail) ----
    await appendCsv(
      SECTIONS_CSV,
      ["time", "ticketClassId", "className", "sectionId", "section", "minPricePerTicket", "listings", "tickets", "row", "cheapestListingId"],
      snap.sections.map((s) => [
        snap.time, s.ticketClassId, s.className, s.sectionId, s.section,
        s.rawMinPrice, s.listings, s.tickets, s.rowText, s.cheapestListingId,
      ])
    );

    // ---- alerting (20% drop vs previous reading, or new category) ----
    if (ALERTS.enabled) {
      try {
        snap.eventUrl = EVENT_URL;
        const kinds = new Set(ALERTS.kinds || ["class", "section", "watch"]);
        const categories = buildCategories(snap, ALERTS.watchTerms).filter((c) => kinds.has(c.kind));
        let state = { initialized: false, cats: {} };
        if (existsSync(ALERT_STATE)) state = JSON.parse(await readFile(ALERT_STATE, "utf8"));
        const firstRun = !state.initialized;
        const events = evaluate(state, categories, {
          dropThreshold: ALERTS.dropThreshold,
          rearmRecovery: ALERTS.rearmRecovery,
          time: snap.time,
        });
        await writeFile(ALERT_STATE, JSON.stringify(state, null, 0));

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
  } finally {
    await ctx.close();
  }
}

main().then(
  () => process.exit(0),
  async (e) => { await log(`ERROR ${e.message}`); process.exit(1); }
);
