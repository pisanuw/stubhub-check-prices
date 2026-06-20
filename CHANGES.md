# Changes

Format: `YYYY-MM-DD [type] description` (max 200 chars). Types: decision, plan, doc, scope, code, note.

2026-06-14 [note] Initialized.

2026-06-14 [scope] Project = personal price tracker for StubHub event 153020544 (US v Australia WC, 6/19/2026), check every 15 min for cheapest price per ticket class.
2026-06-14 [decision] Prices live in server-rendered `<script id="index-data">` JSON, not the DOM (map is WebGL canvas, listing cards virtualized). Parse that blob via Playwright + real Chrome.
2026-06-14 [decision] Use dedicated .chrome-profile not user's Profile 9 (macOS Chrome holds a profile lock while running). No login needed; prices are public.
2026-06-14 [code] Built parse.mjs + scrape.mjs (per-class prices.csv, per-section sections.csv, scrape.log). Validated against fixture + live runs.
2026-06-14 [decision] Watch FILTER left open (log all classes, flag none) per user; editable in config.mjs later.
2026-06-14 [code] Installed launchd agent com.pisan.stubhub-prices (StartInterval 900, RunAtLoad). Verified scheduled run exits 0 and appends CSV.
2026-06-14 [note] Taxonomy: 9 ticket classes (incl. Hospitality); hospitality products are sections (Pitchside Lounge) or listing notes (Champions Club). FIFA Pavilion/Trophy Lounge absent currently.
2026-06-14 [decision] Email alerts: >=20% drop vs previous reading OR new category appears; scope=ALL categories; once-until-reset (re-arm +10% or new lower low). Resend via .env.
2026-06-14 [code] Added parse.buildCategories (classes+sections+watched notes), alert.mjs (state engine), notify.mjs (Resend). Section names now from venueConfiguration (complete).
2026-06-14 [code] Wired alerting into scrape.mjs; loads .env via process.loadEnvFile. Tested logic offline + sent live test email OK. Baseline established (95 categories).
2026-06-14 [decision] Move off laptop to cloud. Chosen: GitHub Actions (cron */15) + Supabase for state/history. Netlify rejected (Playwright fit poor); datacenter-IP block risk flagged.
2026-06-14 [code] git init + pushed to github.com/pisanuw/stubhub-check-prices. Repo made PUBLIC for free Actions minutes (no secrets in repo).
2026-06-14 [note] Smoke test confirmed StubHub serves full data to GitHub cloud IP (not blocked). Local IP intermittently blocked now (expected fragility).
2026-06-14 [code] Added store.mjs (Supabase via PostgREST when SUPABASE_URL/KEY set, else local files), CHROME_CHANNEL env. Supabase schema in "Ranked Voting": stubhub_app_state + stubhub_price_snapshots (RLS, anon policies).
2026-06-14 [code] Added check-prices.yml (cron */15, secrets) + smoke.yml (manual). Set 5 Action secrets. Verified prod run: 9 class snapshots + baseline state (94 cats) in Supabase.
2026-06-14 [scope] Decommissioned local launchd agent com.pisan.stubhub-prices (cloud is now source of truth).
2026-06-14 [code] Added Supabase views stubhub_latest_prices + stubhub_daily_low (security_invoker, granted anon). Added heartbeat (heartbeat.mjs + heartbeat.yml); verified real cloud send OK.
2026-06-14 [scope] Heartbeat changed weekly -> daily (cron 0 14 * * *, 24h window).
2026-06-14 [code] Added query.mjs (terminal Supabase reads: latest/daily/runs/watch/raw) + npm run query. Namespaced env to STUBHUB_SUPABASE_URL/KEY (shared .env had bare SUPABASE_URL pointing at a different project 'upvoteme'; stubhub tables are in 'Ranked Voting'=VITE_SUPABASE_URL). Workflows map secrets->STUBHUB_ env. Verified cloud run still writes Supabase (9->18 rows).

2026-06-15 [code] Bumped GitHub Actions to clear Node 20 deprecation: checkout@v4->v5, setup-node@v4->v5, node-version 22->24 across check-prices/heartbeat/smoke. upload-artifact still @v4 (no v5 released; will keep warning).

2026-06-16 [code] Alerting (scrape.mjs/check-prices) now ignores 8 classes (Category 1-4, Upper 300/Middle 200/Lower 100-Level, Lower Charter) + their sections via ALERTS.ignoreClasses; buildCategories tags each cat with parent class (cls). Heartbeat unaffected (reads Supabase directly). Only Hospitality + watch products alert now.

2026-06-20 [scope] Multi-event support. URLs moved to events.json (id/label/url/enabled). scrape/heartbeat/query loop/scope by enabled events; alert state + history keyed per event_id. Switched to 7/6/2026 event 153020574; disabled 6/19 event 153020544.

2026-06-20 [code] config.mjs loads events.json (EVENTS/ENABLED_EVENTS); store.mjs lazy env + per-event state key + latestByClass/runCount helpers; heartbeat/query read base table per-event. seed-login uses first enabled event.

2026-06-20 [decision] DB: schema already had event_id; sql/001_multi_event.sql makes views event-aware (+event_id), adds indexes, deletes old June data + legacy alert-state key. Pending apply via psql (need Postgres connection string for Ranked Voting).

2026-06-20 [code] Applied sql/001_multi_event.sql to Ranked Voting (via session pooler; direct db.<ref>:5432 refuses, PostgREST up). Event-aware views (+event_id), 2 indexes, deleted 2737 June rows + legacy alert-state key. Verified cloud run wrote 7 July rows + alert-state:153020574 baseline.
