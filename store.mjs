// Persistence abstraction. When STUBHUB_SUPABASE_URL + STUBHUB_SUPABASE_KEY are
// set (cloud / CI), state and price history live in Supabase. Otherwise they
// fall back to local files (alert-state*.json + prices.csv) so local dev works.
//
// Multi-event: snapshots are tagged with event_id, and alert state is stored
// under a per-event key (alert-state:<eventId>).

import { readFile, writeFile, appendFile } from "fs/promises";
import { existsSync } from "fs";

// Read env lazily (inside calls) so it doesn't matter whether the caller loads
// .env before or after importing this module.
function cfg() {
  const URL = process.env.STUBHUB_SUPABASE_URL;
  const KEY = process.env.STUBHUB_SUPABASE_KEY;
  return { URL, KEY, on: !!(URL && KEY) };
}
export function usingSupabase() {
  return cfg().on;
}

const STATE_KEY = "alert-state"; // legacy/default; callers pass per-event keys
const T_STATE = "stubhub_app_state";
const T_SNAP = "stubhub_price_snapshots";

function headers(extra = {}) {
  const { KEY } = cfg();
  return { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...extra };
}

async function sb(path, opts = {}) {
  const { URL } = cfg();
  const res = await fetch(`${URL}/rest/v1/${path}`, opts);
  const body = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status} on ${path}: ${body.slice(0, 300)}`);
  return body ? JSON.parse(body) : null;
}

// ---- alert state -------------------------------------------------------
// Pass `key` to scope state per event, e.g. key: `alert-state:153020574`.
export async function loadState({ stateFile, key = STATE_KEY } = {}) {
  if (usingSupabase()) {
    const rows = await sb(`${T_STATE}?key=eq.${encodeURIComponent(key)}&select=value`, { headers: headers() });
    return rows && rows[0] ? rows[0].value : { initialized: false, cats: {} };
  }
  if (stateFile && existsSync(stateFile)) return JSON.parse(await readFile(stateFile, "utf8"));
  return { initialized: false, cats: {} };
}

export async function saveState(state, { stateFile, key = STATE_KEY } = {}) {
  if (usingSupabase()) {
    await sb(T_STATE, {
      method: "POST",
      headers: headers({ Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify([{ key, value: state, updated_at: new Date().toISOString() }]),
    });
    return;
  }
  if (stateFile) await writeFile(stateFile, JSON.stringify(state, null, 0));
}

// ---- per-class price history ------------------------------------------
// rows: [{captured_at, event_id, ticket_class_id, class_name, min_price,
//         total_for_qty, qty, listings, tickets}]
export async function saveClassSnapshots(rows, { csvPath } = {}) {
  if (!rows.length) return;
  if (usingSupabase()) {
    await sb(T_SNAP, {
      method: "POST",
      headers: headers({ Prefer: "return=minimal" }),
      body: JSON.stringify(rows),
    });
    return;
  }
  if (csvPath) {
    const header = "time,eventId,ticketClassId,className,minPricePerTicket,totalForQty,qty,listings,tickets";
    if (!existsSync(csvPath)) await writeFile(csvPath, header + "\n");
    const cell = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const body = rows.map((r) => [r.captured_at, r.event_id, r.ticket_class_id, r.class_name,
      r.min_price, r.total_for_qty, r.qty, r.listings, r.tickets].map(cell).join(",")).join("\n");
    await appendFile(csvPath, body + "\n");
  }
}

// ---- event-scoped reads (for heartbeat / query) -----------------------
// Latest snapshot row per class for one event. Pulls recent rows and keeps the
// newest per class in JS, so it doesn't depend on any DB view.
export async function latestByClass(eventId, { withinHours = 6 } = {}) {
  if (!usingSupabase()) return [];
  const since = new Date(Date.now() - withinHours * 36e5).toISOString();
  const rows = await sb(
    `${T_SNAP}?select=class_name,min_price,total_for_qty,listings,tickets,captured_at` +
    `&event_id=eq.${encodeURIComponent(eventId)}&captured_at=gte.${since}&order=captured_at.desc`,
    { headers: headers() }
  );
  const seen = new Map();
  for (const r of rows || []) if (!seen.has(r.class_name)) seen.set(r.class_name, r);
  return [...seen.values()].sort((a, b) => a.min_price - b.min_price);
}

// Count successful checks for one event over the last N hours. One stable class
// is written once per run, so counting its rows == counting runs.
export async function runCount(eventId, { hours = 24, stableClass = "Upper 300-Level" } = {}) {
  if (!usingSupabase()) return { count: 0, last: null };
  const since = new Date(Date.now() - hours * 36e5).toISOString();
  const rows = await sb(
    `${T_SNAP}?select=captured_at&event_id=eq.${encodeURIComponent(eventId)}` +
    `&class_name=eq.${encodeURIComponent(stableClass)}&captured_at=gte.${since}&order=captured_at.desc`,
    { headers: headers() }
  );
  return { count: (rows || []).length, last: rows && rows[0] ? rows[0].captured_at : null };
}
