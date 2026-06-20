# Briefing

- Purpose: Track StubHub ticket prices for one or more events, checking every 15
  minutes and logging cheapest price per ticket class. The events to monitor live
  in events.json (id/label/url/enabled). Currently watching ONLY World Cup Seattle
  2026-07-06 (event 153020574); the old 2026-06-19 event 153020544 is disabled and
  its data deleted from Supabase.
- Current scope: Personal, multi-event, intentionally fragile. Playwright loads
  each enabled event page; prices parsed from the server-rendered
  `<script id="index-data">` JSON blob. Price history + alert state are per event
  (keyed by StubHub event id). Email alerts (Resend) on >=20% price drop vs previous reading OR a
  category appearing for the first time. Alerting scope is now narrowed:
  ALERTS.ignoreClasses excludes 8 classes (Category 1-4, Upper 300-Level,
  Middle 200-Level, Lower 100-Level, Lower Charter) and their sections, so only
  Hospitality + watched named products (Champions Club, Hospitality, Trophy
  Lounge, FIFA Pavilion) trigger alerts. The daily heartbeat is unaffected and
  still reports every class.
- Deployment: GitHub Actions (public repo pisanuw/stubhub-check-prices) cron
  (check-prices.yml now cron "17 * * * *"); state + per-class history in Supabase
  project "Ranked Voting" (table stubhub_price_snapshots has event_id;
  stubhub_app_state holds per-event alert state under key alert-state:<eventId>).
  Event-aware views stubhub_latest_prices / stubhub_daily_low (both expose
  event_id) + indexes via sql/001_multi_event.sql. CHROME_CHANNEL=chromium in CI.
  Local launchd agent decommissioned (cloud is source of truth).
- Key decisions:
  - Data source = embedded `index-data` JSON island (DOM is WebGL canvas +
    virtualized cards; no usable rendered prices). No login needed (public).
  - Dedicated Chrome profile (`.chrome-profile`), NOT the user's Profile 9,
    because macOS Chrome holds a profile lock while running. Headless runs.
  - Scheduler = launchd LaunchAgent (com.pisan.stubhub-prices), StartInterval 900.
  - Section names from venueMapData.venueConfiguration (complete); only ~40
    listings carry per-listing notes, so note-only products (Champions Club)
    have partial price coverage.
  - Alerts: drop baseline = previous reading; scope = all categories EXCEPT the
    8 in ALERTS.ignoreClasses (only Hospitality + watch products alert); re-send
    = once until reset (re-arm on +10% recovery or new lower low). Heartbeat
    ignores the exclude list (reports all classes). Resend email noreply@pisan.me
    -> yusuf.pisan@gmail.com (from .env). State keyed per event.
  - Events live in events.json (config file), NOT in the DB, so they are easy to
    edit. scrape/heartbeat/query all loop/scope by enabled events. Heartbeat and
    query read per-event off the base table (no view dependency); only `query
    daily` uses the event-aware view.
- Non-goals: Auto-purchasing tickets; robustness against StubHub redesigns; full
  per-listing detail beyond the ~40 the page embeds. (Multi-event is now in scope.)
