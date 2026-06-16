// Configuration for the StubHub price checker.
// Fragile-on-purpose: tuned for one specific event.

import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const ROOT = __dirname;

// The event we are watching.
export const EVENT_URL =
  "https://www.stubhub.com/world-cup-seattle-tickets-6-19-2026/event/153020544/?quantity=2";

export const EVENT_ID = "153020544";

// Dedicated Chrome profile so we don't collide with your everyday Chrome.
// Seeded once via `npm run login`, reused on every scheduled run.
export const PROFILE_DIR = join(ROOT, ".chrome-profile");

// Output files.
export const CSV_PATH = join(ROOT, "prices.csv");
export const LOG_PATH = join(ROOT, "scrape.log");
export const DISCOVERY_DIR = join(ROOT, "discovery");

// Run the browser without a visible window. Set to false (or run
// `HEADLESS=0 npm run scrape`) if StubHub starts challenging the headless runs.
export const HEADLESS = process.env.HEADLESS !== "0";

// How long to wait (ms) for listings to load after navigation.
export const LOAD_WAIT_MS = 12000;

// ---- Ticket-class filter (fill in later) -------------------------------
// Listings are kept in the CSV regardless; this only controls what counts
// as a "match" for the highlighted summary line in the log.
export const FILTER = {
  quantity: 2, // need 2 tickets together
  maxPrice: null, // e.g. 400  -> only flag listings at/under this all-in price
  sections: [], // e.g. ["100", "112"] -> substring match on section name
  zones: [], // e.g. ["Lower Level"]
};

// ---- Email alerting -----------------------------------------------------
export const ALERTS = {
  // Email on a >=DROP_THRESHOLD price drop vs the PREVIOUS reading, and when a
  // category appears for the first time. Scope = ALL categories.
  enabled: true,
  dropThreshold: 0.2, // 0.2 = alert on a >=20% drop vs the previous reading
  rearmRecovery: 0.1, // re-arm a latched drop once price rises >=10% back

  // Which category kinds to alert on. Section-level is the noisiest (a single
  // listing appearing/selling can swing a section min >20%). To quiet things,
  // drop "section": e.g. ["class", "watch"].
  kinds: ["class", "section", "watch"],

  // Classes to EXCLUDE from alerting (scrape.mjs / check-prices workflow only).
  // Drops both the class category and its section-level children; watched
  // named products are unaffected. The daily heartbeat reads Supabase directly
  // and still reports every class, so it ignores this list. Case-insensitive.
  ignoreClasses: [
    "Category 1", "Category 2", "Category 3", "Category 4",
    "Upper 300-Level", "Middle 200-Level", "Lower 100-Level", "Lower Charter",
  ],

  // Named products of special interest. Tracked as their own categories even
  // when they only show up as a section name or a listing note.
  watchTerms: ["Champions Club", "Hospitality", "Trophy Lounge", "FIFA Pavilion", "FIFA Pavillion"],

  // Resend config (values come from .env: RESEND_API_KEY, FROM_EMAIL, ADMIN_EMAIL).
  // Set ALERT_DRYRUN=1 to log the email instead of sending it.
  stateFile: "alert-state.json",
};
