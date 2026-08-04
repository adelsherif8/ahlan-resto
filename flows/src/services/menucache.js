// One menu read per turn, everywhere. Router fast-paths, the router's verbless
// rule, and both agents' load nodes previously each SELECTed menu_items —
// up to four identical reads on the latency path. 20s TTL: menu edits land
// within a breath, and a single burst costs one query.
let cache = { at: 0, rows: [] };

export async function getMenu(db) {
  if (Date.now() - cache.at > 20_000) {
    const { data, error } = await db.from("menu_items").select("*").order("sort_order");
    if (!error) cache = { at: Date.now(), rows: data || [] };
  }
  return cache.rows;
}

export function bustMenuCache() { cache = { at: 0, rows: [] }; }
