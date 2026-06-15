// Parses the StubHub event page's embedded `index-data` JSON island into a
// tidy snapshot. All the pricing lives in this server-rendered blob, so we
// never have to deal with the WebGL map or the virtualized listing cards.

export function extractIndexData(rawHtml) {
  const m = rawHtml.match(
    /<script id="index-data" type="application\/json">([\s\S]*?)<\/script>/
  );
  if (!m) throw new Error("index-data island not found (page blocked or layout changed?)");
  return JSON.parse(m[1]);
}

export function buildSnapshot(rawHtml, isoTime = new Date().toISOString()) {
  const j = extractIndexData(rawHtml);
  const g = j.grid;
  const vmd = g.venueMapData || {};

  // id -> class name
  const className = {};
  (j.ticketClasses || []).forEach((t) => (className[t.ticketClassId] = t.name));
  (g.items || []).forEach((i) => (className[i.ticketClass] = i.ticketClassName));

  // sectionId -> human name. venueConfiguration is authoritative and covers
  // EVERY currently-listed section (not just the detailed first page).
  const sectionName = {};
  const vc = vmd.venueConfiguration || {};
  Object.values(vc).forEach((e) => {
    if (e && e.sectionId != null && e.sectionName) sectionName[e.sectionId] = e.sectionName;
  });
  (g.items || []).forEach((i) => { if (!sectionName[i.sectionId]) sectionName[i.sectionId] = i.section; });

  // Per ticket-class summary (complete: covers all listings).
  const classes = Object.entries(vmd.ticketClassPopupData || {})
    .map(([id, d]) => ({
      ticketClassId: Number(id),
      className: className[id] || `class ${id}`,
      rawMinPrice: d.rawMinPrice,
      formattedMinPrice: d.formattedMinPrice,
      listings: d.count,
      tickets: d.ticketCount,
    }))
    .sort((a, b) => a.rawMinPrice - b.rawMinPrice);

  // Per section/class group (key is `{ticketClass}_{sectionId}`).
  const sections = Object.entries(vmd.sectionPopupData || {})
    .map(([key, d]) => {
      const [tc, sid] = key.split("_").map(Number);
      return {
        key,
        ticketClassId: tc,
        className: className[tc] || `class ${tc}`,
        sectionId: sid,
        section: sectionName[sid] || "",
        rawMinPrice: d.rawMinPrice,
        formattedMinPrice: d.formattedMinPrice,
        listings: d.count,
        tickets: d.ticketCount,
        rowText: d.rowText || "",
        cheapestListingId: d.listingId || 0,
      };
    })
    .sort((a, b) => a.rawMinPrice - b.rawMinPrice);

  // Detailed listings (only the ~40 the page embeds) carry per-listing NOTES.
  // Used for best-effort matching of note-only products (e.g. "Champions Club").
  const detailedListings = (g.items || []).map((i) => ({
    className: i.ticketClassName,
    section: i.section,
    rawPrice: i.rawPrice,
    formattedPrice: i.price,
    notes: (i.listingNotes || []).map((n) => n.formattedListingNoteContent),
  }));

  // Event-wide catalog of possible note labels (no price; availability flag).
  const noteCatalog = (j.sellerListingNotes || []).map((n) => ({
    note: n.formattedListingNoteContent,
    hasAvailableListings: !!n.hasAvailableListings,
  }));

  return {
    time: isoTime,
    eventId: j.eventId,
    eventName: j.eventName,
    quantity: g.quantity,
    totalListings: g.totalCount,
    detailedCount: detailedListings.length,
    overallMinPrice: g.formattedMinPrice,
    overallMaxPrice: g.formattedMaxPrice,
    classes,
    sections,
    detailedListings,
    noteCatalog,
    sectionNames: sectionName, // for caching across runs
  };
}

// Money formatter for emails/logs.
export function usd(n) {
  return n == null ? "n/a" : "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

// Build the flat list of "categories" we track for alerting:
//   - every ticket class
//   - every currently-listed section (class > section)
//   - each watched named-product term, matched across class/section/notes
// Each category has a stable `key`, a `label`, and a current `price` (min, per
// ticket) or null if not present this run.
export function buildCategories(snap, watchTerms = []) {
  const cats = new Map();
  const put = (key, label, price, kind) => {
    const cur = cats.get(key);
    if (!cur || (price != null && (cur.price == null || price < cur.price)))
      cats.set(key, { key, label, price, kind });
  };

  for (const c of snap.classes) put(`class:${c.className}`, c.className, c.rawMinPrice, "class");
  for (const s of snap.sections)
    put(`sec:${s.className}|${s.section}`, `${s.className} › ${s.section}`, s.rawMinPrice, "section");

  // Watched named products: lowest price anywhere the term shows up.
  const classNames = new Set(snap.classes.map((c) => c.className.toLowerCase()));
  for (const term of watchTerms) {
    const t = term.toLowerCase();
    // Already covered as a first-class ticket class? Skip the duplicate.
    if (classNames.has(t)) continue;
    const norm = (x) => (x || "").toLowerCase();
    let min = null;
    const consider = (p) => { if (p != null && (min == null || p < min)) min = p; };
    for (const c of snap.classes) if (norm(c.className).includes(t)) consider(c.rawMinPrice);
    for (const s of snap.sections) if (norm(s.section).includes(t) || norm(s.className).includes(t)) consider(s.rawMinPrice);
    for (const l of snap.detailedListings)
      if (l.notes.some((n) => norm(n).includes(t))) consider(l.rawPrice);
    // Present (with unknown price) if only the event-wide catalog flags it.
    const inCatalog = snap.noteCatalog.some((n) => norm(n.note).includes(t) && n.hasAvailableListings);
    if (min != null || inCatalog) put(`watch:${term}`, term, min, "watch");
  }

  return [...cats.values()];
}
