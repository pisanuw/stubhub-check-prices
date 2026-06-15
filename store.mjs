// Persistence abstraction. When SUPABASE_URL + SUPABASE_KEY are set (cloud /
// CI), state and price history live in Supabase. Otherwise they fall back to
// local files (alert-state.json + prices.csv) so local dev is unchanged.

import { readFile, writeFile, appendFile } from "fs/promises";
import { existsSync } from "fs";

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_KEY;
export const usingSupabase = !!(URL && KEY);

const STATE_KEY = "alert-state";
const T_STATE = "stubhub_app_state";
const T_SNAP = "stubhub_price_snapshots";

function headers(extra = {}) {
  return { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...extra };
}

async function sb(path, opts = {}) {
  const res = await fetch(`${URL}/rest/v1/${path}`, opts);
  const body = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status} on ${path}: ${body.slice(0, 300)}`);
  return body ? JSON.parse(body) : null;
}

// ---- alert state -------------------------------------------------------
export async function loadState({ stateFile } = {}) {
  if (usingSupabase) {
    const rows = await sb(`${T_STATE}?key=eq.${STATE_KEY}&select=value`, { headers: headers() });
    return rows && rows[0] ? rows[0].value : { initialized: false, cats: {} };
  }
  if (stateFile && existsSync(stateFile)) return JSON.parse(await readFile(stateFile, "utf8"));
  return { initialized: false, cats: {} };
}

export async function saveState(state, { stateFile } = {}) {
  if (usingSupabase) {
    await sb(T_STATE, {
      method: "POST",
      headers: headers({ Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify([{ key: STATE_KEY, value: state, updated_at: new Date().toISOString() }]),
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
  if (usingSupabase) {
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
