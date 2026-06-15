// Run Supabase read queries from the terminal (via PostgREST + the publishable
// key). Targets the StubHub project (Ranked Voting) via STUBHUB_SUPABASE_*.
//
//   node query.mjs latest            cheapest per ticket class right now
//   node query.mjs daily [class]     daily low/avg/max (optionally one class)
//   node query.mjs runs [hours]      how many checks ran (default 24h) + last
//   node query.mjs watch             status of the watched named products
//   node query.mjs raw "<path>"      any PostgREST query, e.g.
//                                    raw "stubhub_price_snapshots?select=*&limit=5"

import { join } from "path";
try { process.loadEnvFile(join(process.cwd(), ".env")); } catch { /* no .env */ }

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

const [cmd, ...args] = process.argv.slice(2);
try {
  switch (cmd) {
    case "latest":
      show(await q("stubhub_latest_prices?select=class_name,min_price,total_for_qty,listings,tickets,captured_at&order=min_price.asc"));
      break;
    case "daily": {
      const cls = args.join(" ");
      const f = cls ? `&class_name=eq.${encodeURIComponent(cls)}` : "";
      show(await q(`stubhub_daily_low?select=day_pt,class_name,day_min_price,day_max_price,day_avg_price,samples${f}&order=day_pt.desc&limit=80`));
      break;
    }
    case "runs": {
      const hrs = Number(args[0] || 24);
      const since = new Date(Date.now() - hrs * 36e5).toISOString();
      const rows = await q(`stubhub_price_snapshots?select=captured_at&class_name=eq.Upper%20300-Level&captured_at=gte.${since}&order=captured_at.desc`);
      console.log(`Successful checks in the last ${hrs}h: ${rows.length}`);
      if (rows.length) console.log(`Most recent: ${new Date(rows[0].captured_at).toString()}`);
      break;
    }
    case "watch": {
      const terms = ["Hospitality", "Champions Club", "Trophy Lounge", "FIFA Pavilion"];
      const latest = await q("stubhub_latest_prices?select=class_name,min_price,listings");
      show(terms.map((t) => {
        const m = latest.find((r) => r.class_name.toLowerCase().includes(t.toLowerCase()));
        return { product: t, status: m ? "listed" : "not present", from: m ? m.min_price : "-", listings: m ? m.listings : 0 };
      }));
      break;
    }
    case "raw":
      show(await q(args.join(" ")));
      break;
    default:
      console.log(`usage:
  node query.mjs latest            cheapest per ticket class right now
  node query.mjs daily [class]     daily low/avg/max (optionally one class)
  node query.mjs runs [hours]      how many checks ran (default 24h) + last
  node query.mjs watch             status of the watched named products
  node query.mjs raw "<path>"      any PostgREST query`);
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
