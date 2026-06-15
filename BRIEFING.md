# Briefing

- Purpose: Track StubHub ticket prices for one event (US vs Australia, World Cup
  Group D Match 32, Lumen Field, 2026-06-19; StubHub event 153020544), checking
  every 15 minutes and logging cheapest price per ticket class.
- Current scope: Personal, single-event, intentionally fragile. Playwright loads
  the page; prices parsed from the server-rendered `<script id="index-data">`
  JSON blob. Email alerts (Resend) on >=20% price drop vs previous reading OR a
  category appearing for the first time, across ALL categories (classes +
  sections + watched named products: Champions Club, Hospitality, Trophy Lounge,
  FIFA Pavilion).
- Deployment: GitHub Actions (public repo pisanuw/stubhub-check-prices) cron
  */15; state + per-class history in Supabase project "Ranked Voting" (tables
  stubhub_app_state, stubhub_price_snapshots). CHROME_CHANNEL=chromium in CI.
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
  - Alerts: drop baseline = previous reading; scope = all categories; re-send =
    once until reset (re-arm on +10% recovery or new lower low). Resend email
    noreply@pisan.me -> yusuf.pisan@gmail.com (from .env). State in alert-state.json.
- Non-goals: Auto-purchasing tickets; multi-event support; robustness against
  StubHub redesigns; full per-listing detail beyond the ~40 the page embeds.
