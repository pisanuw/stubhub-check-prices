# StubHub price checker

Fragile price tracker for one or more StubHub events. The events to monitor live
in [events.json](events.json) (edit that file to add, remove, or switch events —
no code change needed). Currently watching **World Cup Seattle, 2026-07-06**
(event `153020574`).

Checks each enabled event page every 15 minutes and logs the cheapest price per
ticket class. Price history and alert state are kept per event (keyed by the
StubHub event id).

## How it works

StubHub renders nothing useful in the live DOM (the seat map is a Mapbox WebGL
canvas, the listing cards are virtualized). But the server-rendered HTML embeds
a complete JSON blob in `<script id="index-data">`. We load the page with real
Chrome (Playwright, `channel: 'chrome'`) and parse that blob. No login needed —
prices are public.

- `events.json` — the list of events (web sites) to monitor: `{ id, label, url,
  enabled }`. `id` is the StubHub event id and is the per-event data/state key.
- `config.mjs` — loads `events.json`, plus paths, headless flag, watch `FILTER`,
  and `ALERTS`.
- `parse.mjs` — pulls per-class and per-section min prices out of the HTML, and
  builds the flat "category" list used for alerting.
- `scrape.mjs` — one run: loop enabled events; per event load page, parse, append
  history rows, evaluate alerts (per-event state), log.
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

### Daily heartbeat

[.github/workflows/heartbeat.yml](.github/workflows/heartbeat.yml) emails a
"still watching" digest every day (~7am PT) via [heartbeat.mjs](heartbeat.mjs):
how many checks ran in the last 24 hours, the most recent check time, and the
current cheapest price per class. So you know it's alive even when nothing
triggers an alert.

```bash
gh workflow run heartbeat.yml      # send one now
```

### Querying the data (Supabase)

Two event-aware convenience views (project *Ranked Voting*); both carry an
`event_id` column so each event's data is separate:

- `stubhub_latest_prices` — latest price per ticket class, per event.
- `stubhub_daily_low` — daily min/max/avg per class, per event (good for charting).

```sql
select * from stubhub_latest_prices where event_id = '153020574' order by min_price;
select * from stubhub_daily_low where event_id = '153020574' and class_name = 'Hospitality' order by day_pt;
```

From the terminal, [query.mjs](query.mjs) wraps the common reads (uses
`STUBHUB_SUPABASE_URL` / `STUBHUB_SUPABASE_KEY` from `.env`). Every command is
scoped to one event — the first enabled event by default, or pass `--event <id>`
(or `--event all`):

```bash
npm run query events          # list configured events
npm run query latest          # cheapest per class right now (default event)
npm run query daily Hospitality   # daily low/avg/max for one class
npm run query runs 24         # how many checks ran in last 24h + last time
npm run query watch           # are Champions Club / Trophy Lounge / FIFA Pavilion listed yet
npm run query latest --event all              # all configured events
npm run query latest --event 153020544        # a specific event
npm run query raw "stubhub_price_snapshots?select=*&limit=5"   # any PostgREST query
```

> The event-aware views require the `sql/001_multi_event.sql` migration to have
> been applied (it also adds indexes and removes the old June 19 event's data).

> Note: this project uses `STUBHUB_SUPABASE_*` env vars (not the bare
> `SUPABASE_*`) so a shared `.env` pointing at another Supabase project can't
> send writes/queries to the wrong database.

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
  ≥10%. State is per event: locally `alert-state.<eventId>.json`, in Supabase the
  `stubhub_app_state` row keyed `alert-state:<eventId>` (delete to reset baseline).
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
