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
