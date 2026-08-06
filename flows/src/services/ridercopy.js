// ONE voice for every delivery update, wherever it fires from.
// The board (staff drags a ticket) and the driver page (rider taps a button)
// used to word the same events differently — a guest could get "is ON ITS WAY
// with Ahmed to X" from one path and "is ON ITS WAY to X" from the other for
// the same order. Both now call these.
//
// Every line is pure code: names, addresses and amounts come from the order row,
// never from a model, and the sender is always the RESTAURANT's number.

const first = (name) => String(name || "").trim().split(/\s+/)[0] || "";
const money = (n) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });

export const riderCopy = {
  // kitchen → rider handoff — this is the moment a track link earns its keep: before
  // dispatch there is no rider position to show, so no earlier push carries one.
  out: (o, trackUrl) => `🛵 Order ${o.code} is ON ITS WAY${o.courier_name ? ` with ${first(o.courier_name)}` : ""}${o.address ? ` to ${o.address}` : ""}!${trackUrl ? `\n📍 Track live: ${trackUrl}` : ""}`,

  near: (o) => `📍 ${o.courier_name ? `${first(o.courier_name)} is` : "Your rider is"} 2 minutes away with order ${o.code} — see you in a moment!`,

  // the rider is AT the door — cash guests get the exact amount to have ready
  arrived: (o) => `🚪 ${o.courier_name ? `${first(o.courier_name)} has` : "Your rider has"} ARRIVED with order ${o.code}${o.address ? "" : ""} — at your door now!${o.payment_method === "cash" ? ` Cash to have ready: EGP ${money(o.total)}.` : ""}`,

  delay: (o, mins = 10) => `⏳ Quick heads-up — order ${o.code} is running about ${mins} minutes behind. Sorry, and thanks for the patience 🙏`,

  delivered: (o) => `🎉 Order ${o.code} delivered — enjoy! How was everything? A quick rating from 1–5 helps us a lot 🙌`,
};
