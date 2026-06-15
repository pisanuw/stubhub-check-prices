# StubHub price checker

Fragile, single-event price tracker for **US vs Australia, World Cup Group D
(Match 32), Lumen Field, 2026-06-19** (StubHub event `153020544`).

Checks the event page every 15 minutes and logs the cheapest price per ticket
class to CSV.

## How it works

StubHub renders nothing useful in the live DOM (the seat map is a Mapbox WebGL
canvas, the listing cards are virtualized). But the server-rendered HTML embeds
a complete JSON blob in `<script id="index-data">`. We load the page with real
Chrome (Playwright, `channel: 'chrome'`) and parse that blob. No login needed —
prices are public.

- `config.mjs` — event URL, paths, headless flag, watch `FILTER`, and `ALERTS`.
- `parse.mjs` — pulls per-class and per-section min prices out of the HTML, and
  builds the flat "category" list used for alerting.
- `scrape.mjs` — one run: load page, parse, append CSV rows, evaluate alerts, log.
- `alert.mjs` — stateful alert engine (20% drop vs previous, new category).
- `notify.mjs` — sends email via Resend.
- `seed-login.mjs` — optional one-time headed login into the dedicated profile.

## Output

- `prices.csv` — one row per ticket class per run (the main trend log).
- `sections.csv` — one row per section/class group per run (finer detail).
- `scrape.log` — human-readable summary per run.
- `section-names.json` — learned sectionId → name cache (grows over time).

Prices are **per ticket, all-in (incl. fees)**. `totalForQty` = price × 2.

## Run manually

```bash
npm run scrape          # headless
HEADLESS=0 npm run scrape   # visible browser, if StubHub ever challenges it
```

## Scheduling

### Cloud (production) — GitHub Actions + Supabase

Runs every 15 min in GitHub Actions ([.github/workflows/check-prices.yml](.github/workflows/check-prices.yml)),
so your laptop can be off. The runner installs Chromium, runs `scrape.mjs` with
`CHROME_CHANNEL=chromium`, and persists to Supabase.

- **State + history live in Supabase** (project `Ranked Voting`): tables
  `stubhub_app_state` (alert state JSON) and `stubhub_price_snapshots`
  (per-class history). Activated automatically when `SUPABASE_URL` +
  `SUPABASE_KEY` are present; otherwise the script falls back to local files.
- **Secrets** (Actions → repo settings): `RESEND_API_KEY`, `FROM_EMAIL`,
  `ADMIN_EMAIL`, `SUPABASE_URL`, `SUPABASE_KEY`.
- The repo is **public** so Actions minutes are free at this cadence.
- `smoke.yml` is a manual workflow that checks StubHub still serves data to a
  cloud IP (no secrets/email).

```bash
gh workflow run check-prices.yml      # run once now
gh run list --workflow=check-prices.yml
gh run view <run-id> --log
```

GitHub cron is best-effort and can lag a few minutes under load.

### Local (optional) — launchd

If you'd rather run it on a Mac instead, a LaunchAgent works too (drop the
Supabase env so it uses local files). Not installed by default anymore.

## Watching a specific ticket class

Edit `FILTER` in `config.mjs`. Currently all classes are logged and none are
specially flagged. Available classes (with sample cheapest, per ticket):

| Class            | sample $/tkt |
|------------------|--------------|
| Upper 300-Level  | ~$2,259      |
| Middle 200-Level | ~$2,515      |
| Lower 100-Level  | ~$3,024      |
| Lower Charter    | ~$5,049      |
| Hospitality      | ~$4,322      |
| Category 1–4     | ~$2,400–3,055|

Example — flag Lower 100-Level at/under $2,800/ticket:

```js
export const FILTER = {
  quantity: 2,
  maxPrice: 2800,
  sections: [],
  zones: ["Lower 100-Level"], // substring match on class name
};
```

Matches show as `>> MATCH ...` lines in `scrape.log`. (Note: this only changes
logging; every class is always recorded in the CSV.)

## Email alerts

Configured in `ALERTS` in `config.mjs`. An email is sent (via Resend, using
`RESEND_API_KEY` / `FROM_EMAIL` / `ADMIN_EMAIL` from `.env`) when, for **any**
category:

1. the min price drops **≥20% vs the previous 15-min reading**, or
2. a category **appears for the first time** (never recorded before).

A "category" is every ticket class, every currently-listed section
(`class › section`), plus the named products in `ALERTS.watchTerms`
(`Champions Club`, `Trophy Lounge`, `FIFA Pavilion`, …) matched across class /
section / listing-note text.

- **First run** only establishes a baseline — no email.
- **De-dup:** a drop emails once, then latches; it re-fires only on a new lower
  low (another 20% below the alerted price) and re-arms after the price recovers
  ≥10%. State lives in `alert-state.json` (delete it to reset the baseline).
- All triggers from one run are batched into a single email.
- **Noise control:** `ALERTS.kinds` selects which category granularities alert.
  Section-level is the chattiest (one listing can swing a section min >20%). For
  a quieter inbox use `kinds: ["class", "watch"]` — you'll still get the ticket
  class drops (incl. Hospitality) and the named products, without per-section spam.

Test the email pipeline anytime:

```bash
npm run test-email
ALERT_DRYRUN=1 npm run scrape   # run normally but log emails instead of sending
```

### Coverage caveat

`Hospitality` and any **section** (Trophy Lounge, FIFA Pavilion, Pitchside
Lounge, …) are tracked with full price coverage across all listings.
`Champions Club` only ever appears as a listing *note*, which the page exposes
reliably for ~40 listings; if a Champions Club listing exists outside that set
its price may be missed (you'll still get the "new category" email when it
surfaces). `FIFA Pavilion` / `Trophy Lounge` are not present today and will
trigger the new-category alert when they first appear.
