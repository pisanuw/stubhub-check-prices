// Run Supabase read queries from the terminal (via PostgREST + the publishable
// key). Targets the StubHub project via STUBHUB_SUPABASE_*.
//
//   node query.mjs events             list configured events (from events.json)
//   node query.mjs latest             cheapest per ticket class right now
//   node query.mjs daily [class]      daily low/avg/max (optionally one class)
//   node query.mjs runs [hours]       how many checks ran (default 24h) + last
//   node query.mjs watch              status of the watched named products
//   node query.mjs raw "<path>"       any PostgREST query
//
// All commands except `raw` are scoped to one event. Default = the first
// enabled event in events.json; override with `--event <id>` or `--event all`.

import { join } from "path";
try { process.loadEnvFile(join(process.cwd(), ".env")); } catch { /* no .env */ }

import { EVENTS, ENABLED_EVENTS } from "./config.mjs";
import { latestByClass, runCount } from "./store.mjs";

const URL = process.env.STUBHUB_SUPABASE_URL;
const KEY = process.env.STUBHUB_SUPABASE_KEY;
if (!URL || !KEY) {
  console.error("Set STUBHUB_SUPABASE_URL and STUBHUB_SUPABASE_KEY (in .env).");
  process.exit(1);
}

async function q(path) {
  const r = await fetch(`${URL}/rest/v1/${path}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : [];
}
function show(rows) {
  if (!Array.isArray(rows) || !rows.length) return console.log("(no rows)");
  console.table(rows);
}

// Parse `--event <id>` (or `--event all`) out of the args.
const raw = process.argv.slice(2);
let eventSel = null;
const args = [];
for (let i = 0; i < raw.length; i++) {
  if (raw[i] === "--event") { eventSel = raw[++i]; continue; }
  args.push(raw[i]);
}
const [cmd, ...rest] = args;

// Resolve which events a command runs against.
function targetEvents() {
  if (eventSel === "all") return EVENTS;
  if (eventSel) {
    const e = EVENTS.find((x) => x.id === eventSel);
    if (!e) { console.error(`unknown event id ${eventSel}`); process.exit(1); }
    return [e];
  }
  const def = ENABLED_EVENTS[0] || EVENTS[0];
  if (!def) { console.error("no events configured"); process.exit(1); }
  return [def];
}

try {
  switch (cmd) {
    case "events":
      show(EVENTS.map((e) => ({ id: e.id, label: e.label, enabled: e.enabled !== false })));
      break;
    case "latest":
      for (const ev of targetEvents()) {
        console.log(`\n# ${ev.label || ev.id}`);
        show(await latestByClass(ev.id));
      }
      break;
    case "daily": {
      const cls = rest.join(" ");
      const f = cls ? `&class_name=eq.${encodeURIComponent(cls)}` : "";
      for (const ev of targetEvents()) {
        console.log(`\n# ${ev.label || ev.id}`);
        show(await q(`stubhub_daily_low?select=day_pt,class_name,day_min_price,day_max_price,day_avg_price,samples&event_id=eq.${encodeURIComponent(ev.id)}${f}&order=day_pt.desc&limit=80`));
      }
      break;
    }
    case "runs": {
      const hrs = Number(rest[0] || 24);
      for (const ev of targetEvents()) {
        const { count, last } = await runCount(ev.id, { hours: hrs });
        console.log(`${ev.label || ev.id}: ${count} checks in the last ${hrs}h${last ? `; most recent ${new Date(last).toString()}` : ""}`);
      }
      break;
    }
    case "watch": {
      const terms = ["Hospitality", "Champions Club", "Trophy Lounge", "FIFA Pavilion"];
      for (const ev of targetEvents()) {
        console.log(`\n# ${ev.label || ev.id}`);
        const latest = await latestByClass(ev.id);
        show(terms.map((t) => {
          const m = latest.find((r) => r.class_name.toLowerCase().includes(t.toLowerCase()));
          return { product: t, status: m ? "listed" : "not present", from: m ? m.min_price : "-", listings: m ? m.listings : 0 };
        }));
      }
      break;
    }
    case "raw":
      show(await q(rest.join(" ")));
      break;
    default:
      console.log(`usage:
  node query.mjs events             list configured events
  node query.mjs latest             cheapest per ticket class right now
  node query.mjs daily [class]      daily low/avg/max (optionally one class)
  node query.mjs runs [hours]       how many checks ran (default 24h) + last
  node query.mjs watch              status of the watched named products
  node query.mjs raw "<path>"       any PostgREST query
  (add --event <id> or --event all to pick events; default = first enabled)`);
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
