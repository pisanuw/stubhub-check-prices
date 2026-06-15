// Stateful alert engine.
//
// For each tracked category we remember the last seen price and whether we've
// already alerted on the current drop ("latched"). Rules:
//   - NEW category: key never recorded before (and not the very first run).
//   - DROP: current price <= previous reading * (1 - dropThreshold).
//       * fires once, then latches; re-fires only on a new lower low
//         (another full threshold drop below the last alerted price);
//       * re-arms once price recovers >= rearmRecovery above the alert price.
//
// State shape (alert-state.json):
//   { initialized: true,
//     cats: { "<key>": { label, lastPrice, alertPrice|null, firstSeen, lastSeen } } }

import { usd } from "./parse.mjs";

export function evaluate(state, categories, opts) {
  const { dropThreshold = 0.2, rearmRecovery = 0.1, time } = opts;
  const firstEverRun = !state.initialized;
  state.cats = state.cats || {};
  const events = [];

  for (const c of categories) {
    const prev = state.cats[c.key];
    const price = c.price; // may be null (present but price unknown)

    if (!prev) {
      // New category. Don't alert on the first ever run (just establish baseline).
      if (!firstEverRun) {
        events.push({ type: "new", label: c.label, kind: c.kind, price });
      }
      state.cats[c.key] = {
        label: c.label, lastPrice: price ?? null,
        alertPrice: null, firstSeen: time, lastSeen: time,
      };
      continue;
    }

    // Existing category: check for a drop vs the previous reading.
    if (price != null && prev.lastPrice != null) {
      const dropped = price <= prev.lastPrice * (1 - dropThreshold);
      const isNewLow = prev.alertPrice != null && price <= prev.alertPrice * (1 - dropThreshold);

      if (dropped && (prev.alertPrice == null || isNewLow)) {
        events.push({
          type: "drop", label: c.label, kind: c.kind,
          price, from: prev.lastPrice,
          pct: Math.round((1 - price / prev.lastPrice) * 100),
        });
        prev.alertPrice = price;
      } else if (prev.alertPrice != null && price >= prev.alertPrice * (1 + rearmRecovery)) {
        // Recovered enough -> re-arm so the next drop can fire again.
        prev.alertPrice = null;
      }
    }

    if (price != null) prev.lastPrice = price;
    prev.lastSeen = time;
    prev.label = c.label;
  }

  state.initialized = true;
  return events;
}

export function renderEmail(events, snap) {
  const drops = events.filter((e) => e.type === "drop");
  const news = events.filter((e) => e.type === "new");
  const subject =
    `StubHub: ${drops.length} drop${drops.length === 1 ? "" : "s"}` +
    `, ${news.length} new — ${snap.eventName}`;

  const lines = [];
  lines.push(snap.eventName);
  lines.push(`${snap.totalListings} listings, overall from ${snap.overallMinPrice} (per ticket, all-in)`);
  lines.push("");
  if (drops.length) {
    lines.push(`PRICE DROPS (>=20% vs previous check):`);
    for (const d of drops)
      lines.push(`  • ${d.label}: ${usd(d.from)} → ${usd(d.price)}/tkt  (-${d.pct}%)`);
    lines.push("");
  }
  if (news.length) {
    lines.push(`NEW CATEGORIES (first time seen):`);
    for (const n of news)
      lines.push(`  • ${n.label}${n.price != null ? `: from ${usd(n.price)}/tkt` : " (now available)"}`);
    lines.push("");
  }
  lines.push(snap.eventUrl || "");
  const text = lines.join("\n");

  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const htmlParts = [`<h2>${esc(snap.eventName)}</h2>`,
    `<p>${snap.totalListings} listings, overall from ${esc(snap.overallMinPrice)} (per ticket, all-in)</p>`];
  if (drops.length) {
    htmlParts.push("<h3>Price drops (≥20% vs previous check)</h3><ul>");
    for (const d of drops)
      htmlParts.push(`<li><b>${esc(d.label)}</b>: ${usd(d.from)} → <b>${usd(d.price)}</b>/tkt (−${d.pct}%)</li>`);
    htmlParts.push("</ul>");
  }
  if (news.length) {
    htmlParts.push("<h3>New categories (first time seen)</h3><ul>");
    for (const n of news)
      htmlParts.push(`<li><b>${esc(n.label)}</b>${n.price != null ? `: from ${usd(n.price)}/tkt` : " (now available)"}</li>`);
    htmlParts.push("</ul>");
  }
  if (snap.eventUrl) htmlParts.push(`<p><a href="${esc(snap.eventUrl)}">View on StubHub</a></p>`);

  return { subject, text, html: htmlParts.join("\n") };
}
