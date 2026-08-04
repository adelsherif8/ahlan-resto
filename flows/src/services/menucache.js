// One menu read per turn, everywhere — router fast-paths, the verbless rule,
// and both agents' load nodes previously each SELECTed menu_items. 20s TTL.
// Keyed by the tenant's db client (WeakMap), so multi-tenant routing gets a
// correct per-restaurant cache for free the day it lands.
const caches = new WeakMap();

export async function getMenu(db) {
  let c = caches.get(db);
  if (!c || Date.now() - c.at > 20_000) {
    const { data, error } = await db.from("menu_items").select("*").order("sort_order");
    if (!error) { c = { at: Date.now(), rows: data || [] }; caches.set(db, c); }
    else if (!c) c = { at: 0, rows: [] };
  }
  return c.rows;
}
