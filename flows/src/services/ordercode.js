// Order codes in ONE place. Every front that opens a ticket — chat, POS, the
// sandwich builder — has to produce the same shape, or the branded daily
// sequence a restaurant configured silently applies to only some of its orders.
// Must match backend/src/routes/ordersRoutes.js's alphabet and
// services/availability.js's makeReservationCode — no I/L/O/U confusables,
// since a rider or cashier reads these aloud and a guest types them back.
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

export const randomOrderCode = () =>
  "O-" + Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join("");

// A branded prefix with a DAILY-RESETTING sequence ("JS-041"), or the random
// default. Sequence = today's order count + 1; if the count fails we fall back
// to random, because a ticket must never fail to get a code.
export async function nextOrderCode(db, config) {
  const oc = config?.pos?.order_code || {};
  if (oc.mode !== "daily") return randomOrderCode();
  try {
    const today = new Date().toLocaleDateString("en-CA");
    const { count } = await db.from("orders").select("id", { count: "exact", head: true }).gte("created_at", `${today}T00:00:00`);
    const prefix = String(oc.prefix || "O").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) || "O";
    return `${prefix}-${String((Number(count) || 0) + 1).padStart(3, "0")}`;
  } catch {
    return randomOrderCode();
  }
}
