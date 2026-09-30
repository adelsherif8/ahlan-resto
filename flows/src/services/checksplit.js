// CHECK SPLIT — the arithmetic, and nothing else.
//
// Pure functions: no DB, no LLM, no language. A split is DERIVED from three things —
// the placed order (the source of truth), the participants, and the assignments — so
// the original receipt is never touched and any assignment change just recomputes.
//
// Money is handled in PIASTRES (integers). EGP 12.50 → 1250. Floats are only for
// reading the stored order and for display; every division here is integer division
// with a largest-remainder pass, so the parts always add back up to the whole:
//
//   sum(participant totals) + unassigned total === order total      (to the piastre)
//
// Receipt-level money (service charge, delivery fee, any discount or extra that lives
// on the bill rather than on a line) is distributed in proportion to each person's
// item subtotal. VAT is NOT distributed: menu prices already include it (priceOrder
// sets vat_inclusive), so each person's VAT is the inclusive portion of their own
// total, exactly how the printed receipt shows it.

export const P = 100; // piastres per EGP
export const toP = (egp) => Math.round((Number(egp) || 0) * P);
export const fromP = (p) => Math.round(Number(p) || 0) / P;

/** Stable per-line ids: a receipt can hold two identical lines, so position decides. */
export function lineId(index) { return `L${index + 1}`; }

/**
 * Read a placed order row into a split state. Nothing is mutated — the row stays the
 * source of truth and every number below is derived from it.
 */
export function stateFromOrder(order, { participants = [], assignments = {} } = {}) {
  const items = Array.isArray(order?.items) ? order.items : [];
  const lines = items.map((it, i) => {
    const qty = Math.max(1, Math.round(Number(it.qty) || 1));
    // unit_price is what was actually charged (options applied); price is the menu base
    const unitP = toP(it.unit_price ?? it.price ?? 0);
    return {
      id: lineId(i),
      name: String(it.name || "").trim(),
      name_ar: it.name_ar || null,
      notes: it.notes || null,
      options: it.options || {},
      qty,
      unitP,
      amountP: unitP * qty,
    };
  });
  const itemsP = lines.reduce((s, l) => s + l.amountP, 0);
  const totalP = toP(order?.total ?? 0) || itemsP;
  const serviceP = toP(order?.service_charge ?? 0);
  const deliveryP = toP(order?.delivery_fee ?? 0);
  // whatever else the bill carries (a discount, a packaging fee, a rounding line) is
  // still real money: take it as the remainder so the invariant can never break
  const otherP = totalP - itemsP - serviceP - deliveryP;
  return {
    code: order?.code || null,
    currency: order?.currency || "EGP",
    vatRate: vatRateOf(order),
    lines,
    itemsP,
    serviceP,
    deliveryP,
    otherP,
    totalP,
    participants: participants.map((p) => ({ id: p.id, name: p.name })),
    // { [lineId]: { units: { [pid]: n }, shared: [pid, ...] } }
    assignments: JSON.parse(JSON.stringify(assignments || {})),
  };
}

function vatRateOf(order) {
  const total = Number(order?.total) || 0;
  const tax = Number(order?.tax) || 0;
  if (total > 0 && tax > 0 && tax < total) {
    const net = total - tax;
    if (net > 0) return Math.round((tax / net) * 10000) / 10000; // inclusive VAT → rate
  }
  return 0.14;
}

// ---- participants -----------------------------------------------------------------

const slug = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

/** Find a participant by display name — names are kept EXACTLY as the guest wrote them. */
export function findParticipant(state, name) {
  const want = slug(name);
  if (!want) return null;
  return state.participants.find((p) => slug(p.name) === want)
    || state.participants.find((p) => slug(p.name).startsWith(want) || want.startsWith(slug(p.name)))
    || null;
}

export function addParticipant(state, name) {
  const clean = String(name || "").trim().slice(0, 40);
  if (!clean) return state;
  const existing = findParticipant(state, clean);
  if (existing) return state;
  // the id is internal; the NAME is displayed verbatim, Arabic or Latin as typed
  const id = `p${state.participants.length + 1}_${Date.now().toString(36).slice(-4)}`;
  state.participants.push({ id, name: clean });
  return state;
}

/** Removing someone frees their items back to Unassigned — nothing is ever deleted. */
export function removeParticipant(state, pid) {
  state.participants = state.participants.filter((p) => p.id !== pid);
  for (const a of Object.values(state.assignments)) {
    if (a.units) delete a.units[pid];
    if (a.shared) a.shared = a.shared.filter((x) => x !== pid);
  }
  return state;
}

// ---- assignments ------------------------------------------------------------------

function slot(state, lid) {
  if (!state.assignments[lid]) state.assignments[lid] = { units: {}, shared: [] };
  const a = state.assignments[lid];
  a.units = a.units || {};
  a.shared = a.shared || [];
  return a;
}

export function assignedUnits(a) {
  return Object.values(a?.units || {}).reduce((s, n) => s + (Number(n) || 0), 0);
}

/** Units of a line nobody has taken (a shared line has no free units — see splitShare). */
export function freeUnits(state, line) {
  const a = state.assignments[line.id];
  if (a?.shared?.length) return 0;
  return Math.max(0, line.qty - assignedUnits(a));
}

/**
 * ASSIGN_ITEM — give `qty` units of a line to a participant (default: everything still
 * free, so "Omar took the burger" on a 1× line means that burger).
 */
export function assignItem(state, lid, pid, qty = null) {
  const line = state.lines.find((l) => l.id === lid);
  if (!line || !state.participants.some((p) => p.id === pid)) return state;
  const a = slot(state, lid);
  a.shared = [];                    // naming an owner replaces a share
  delete a.sharedRemainder;
  const held = a.units[pid] || 0;
  const heldByOthers = assignedUnits(a) - held;
  const room = Math.max(0, line.qty - heldByOthers);      // what this person may hold
  const want = qty == null ? room : Math.round(Number(qty) || 0);
  const take = Math.max(0, Math.min(want, room));
  if (take <= 0) delete a.units[pid];
  else a.units[pid] = take;
  return state;
}

/** UNASSIGN_ITEM — back to Unassigned (one person, or the whole line). */
export function unassignItem(state, lid, pid = null) {
  const a = state.assignments[lid];
  if (!a) return state;
  if (pid) {
    delete a.units?.[pid];
    a.shared = (a.shared || []).filter((x) => x !== pid);
  } else {
    state.assignments[lid] = { units: {}, shared: [] };
  }
  return state;
}

/** SHARE_ITEM — one line split equally between people ("the fries are on both of us"). */
export function shareItem(state, lid, pids) {
  const line = state.lines.find((l) => l.id === lid);
  const ids = [...new Set((pids || []).filter((id) => state.participants.some((p) => p.id === id)))];
  if (!line || ids.length === 0) return state;
  state.assignments[lid] = { units: {}, shared: ids };
  return state;
}

/** SPLIT_UNASSIGNED — everything still free is shared equally by the given people. */
export function splitUnassigned(state, pids = null) {
  const ids = (pids && pids.length ? pids : state.participants.map((p) => p.id))
    .filter((id) => state.participants.some((p) => p.id === id));
  if (!ids.length) return state;
  for (const line of state.lines) {
    if (freeUnits(state, line) <= 0) continue;
    const a = slot(state, line.id);
    if (assignedUnits(a) === 0) { a.shared = ids; continue; }
    // part of the line is already someone's: share only what's left, as a sub-line
    a.sharedRemainder = ids;
  }
  return state;
}

// ---- the money --------------------------------------------------------------------

/**
 * Split `amountP` piastres between `ids` as evenly as integers allow, giving the odd
 * piastres to the first ids in order. Deterministic, and the parts always re-sum.
 */
export function divideP(amountP, ids) {
  const out = {};
  const n = ids.length;
  if (!n) return out;
  const base = Math.floor(amountP / n);
  let rest = amountP - base * n;
  for (const id of ids) { out[id] = base + (rest > 0 ? 1 : 0); if (rest > 0) rest--; }
  return out;
}

/**
 * Distribute `amountP` in proportion to `weights` ({id: weightP}) with a largest-
 * remainder pass so the shares add up to exactly `amountP`.
 */
export function proportionP(amountP, weights) {
  const ids = Object.keys(weights);
  const totalW = ids.reduce((s, id) => s + Math.max(0, weights[id]), 0);
  const out = {};
  if (!ids.length || amountP === 0) { for (const id of ids) out[id] = 0; return out; }
  if (totalW <= 0) return divideP(amountP, ids);
  const exact = ids.map((id) => ({ id, v: (amountP * Math.max(0, weights[id])) / totalW }));
  let used = 0;
  for (const e of exact) { out[e.id] = Math.floor(e.v); used += out[e.id]; }
  let rest = amountP - used;
  // biggest fractional part first; ties by weight, then id — stable across runs
  const order = [...exact].sort((a, b) => (b.v - Math.floor(b.v)) - (a.v - Math.floor(a.v))
    || weights[b.id] - weights[a.id] || (a.id < b.id ? -1 : 1));
  for (let i = 0; rest > 0; i = (i + 1) % order.length) { out[order[i].id] += 1; rest--; }
  return out;
}

/**
 * The whole split. Returns per-participant lines and totals, the unassigned remainder,
 * and a reconciliation flag that must always be true.
 */
export function computeSplit(state) {
  const pids = state.participants.map((p) => p.id);
  const itemsByP = Object.fromEntries(pids.map((id) => [id, 0]));
  const linesByP = Object.fromEntries(pids.map((id) => [id, []]));
  const unassigned = [];
  let unassignedP = 0;

  for (const line of state.lines) {
    const a = state.assignments[line.id] || { units: {}, shared: [] };
    const owned = Object.entries(a.units || {}).filter(([pid, n]) => pids.includes(pid) && n > 0);
    const ownedUnits = owned.reduce((s, [, n]) => s + n, 0);

    for (const [pid, n] of owned) {
      const amountP = line.unitP * n;
      itemsByP[pid] += amountP;
      linesByP[pid].push({ id: line.id, name: line.name, name_ar: line.name_ar, qty: n, notes: line.notes, amountP, shared: false });
    }

    const restUnits = line.qty - ownedUnits;
    if (restUnits <= 0) continue;
    const restP = line.unitP * restUnits;
    const sharers = (a.shared?.length ? a.shared : a.sharedRemainder || []).filter((id) => pids.includes(id));
    if (sharers.length) {
      const parts = divideP(restP, sharers);
      for (const pid of sharers) {
        itemsByP[pid] += parts[pid];
        linesByP[pid].push({ id: line.id, name: line.name, name_ar: line.name_ar, qty: restUnits, notes: line.notes, amountP: parts[pid], shared: true, sharedWith: sharers.length });
      }
    } else {
      unassigned.push({ id: line.id, name: line.name, name_ar: line.name_ar, qty: restUnits, notes: line.notes, amountP: restP });
      unassignedP += restP;
    }
  }

  // receipt-level money rides along with the items it belongs to
  const chargesP = state.serviceP + state.deliveryP + state.otherP;
  const weights = { ...itemsByP, __unassigned: unassignedP };
  const chargeShare = proportionP(chargesP, weights);
  const serviceShare = proportionP(state.serviceP, weights);
  const deliveryShare = proportionP(state.deliveryP, weights);

  const participants = state.participants.map((p) => {
    const itemsP = itemsByP[p.id] || 0;
    const totalP = itemsP + (chargeShare[p.id] || 0);
    const vatP = Math.round(totalP - totalP / (1 + state.vatRate));
    return {
      id: p.id,
      name: p.name,
      lines: linesByP[p.id],
      itemsP,
      serviceP: serviceShare[p.id] || 0,
      deliveryP: deliveryShare[p.id] || 0,
      chargesP: chargeShare[p.id] || 0,
      vatP,
      totalP,
      items: fromP(itemsP),
      service: fromP(serviceShare[p.id] || 0),
      delivery: fromP(deliveryShare[p.id] || 0),
      vat: fromP(vatP),
      total: fromP(totalP),
    };
  });

  const unassignedTotalP = unassignedP + (chargeShare.__unassigned || 0);
  const sumP = participants.reduce((s, p) => s + p.totalP, 0) + unassignedTotalP;

  return {
    code: state.code,
    currency: state.currency,
    participants,
    unassigned: unassigned.map((u) => ({ ...u, amount: fromP(u.amountP) })),
    unassignedItemsP: unassignedP,
    unassignedTotalP,
    unassignedItems: fromP(unassignedP),
    unassignedTotal: fromP(unassignedTotalP),
    orderTotalP: state.totalP,
    orderTotal: fromP(state.totalP),
    // the invariant this whole file exists for
    reconciles: sumP === state.totalP,
    offByP: sumP - state.totalP,
  };
}

// ---- the language-independent action layer ----------------------------------------
// Every language funnels into these. One engine, three ways of talking to it.

export const OPS = ["ADD_PARTICIPANT", "REMOVE_PARTICIPANT", "ASSIGN_ITEM", "UNASSIGN_ITEM", "SHARE_ITEM", "SPLIT_UNASSIGNED", "RESET"];

/**
 * Apply interpreted actions. Actions reference REAL line ids and participant names —
 * an action naming a line that isn't on the receipt is dropped, never invented.
 */
export function applyActions(state, actions = []) {
  const applied = [];
  const skipped = [];
  for (const raw of actions.slice(0, 40)) {
    const op = String(raw?.op || "").toUpperCase();
    const pidOf = (name) => {
      if (!name) return null;
      const hit = findParticipant(state, name);
      if (hit) return hit.id;
      addParticipant(state, name);
      return findParticipant(state, name)?.id || null;
    };
    if (op === "ADD_PARTICIPANT") {
      if (!String(raw.person || "").trim()) { skipped.push(raw); continue; }
      addParticipant(state, raw.person); applied.push(raw); continue;
    }
    if (op === "REMOVE_PARTICIPANT") {
      const p = findParticipant(state, raw.person);
      if (!p) { skipped.push(raw); continue; }
      removeParticipant(state, p.id); applied.push(raw); continue;
    }
    if (op === "ASSIGN_ITEM") {
      // the LINE is checked first: an action pointing at a line that isn't on this
      // receipt must change nothing at all — not even add the person it names
      const line = state.lines.find((l) => l.id === raw.line);
      if (!line) { skipped.push(raw); continue; }
      const pid = pidOf(raw.person);
      if (!pid) { skipped.push(raw); continue; }
      assignItem(state, line.id, pid, raw.qty ?? null); applied.push(raw); continue;
    }
    if (op === "UNASSIGN_ITEM") {
      const line = state.lines.find((l) => l.id === raw.line);
      if (!line) { skipped.push(raw); continue; }
      unassignItem(state, line.id, raw.person ? findParticipant(state, raw.person)?.id || null : null);
      applied.push(raw); continue;
    }
    if (op === "SHARE_ITEM") {
      const line = state.lines.find((l) => l.id === raw.line);
      if (!line) { skipped.push(raw); continue; }
      const ids = (raw.people || []).map(pidOf).filter(Boolean);
      if (!ids.length) { skipped.push(raw); continue; }
      shareItem(state, line.id, ids); applied.push(raw); continue;
    }
    if (op === "SPLIT_UNASSIGNED") {
      const ids = (raw.people || []).map(pidOf).filter(Boolean);
      if (!state.participants.length) { skipped.push(raw); continue; }
      splitUnassigned(state, ids.length ? ids : null); applied.push(raw); continue;
    }
    if (op === "RESET") {
      state.assignments = {}; state.participants = []; applied.push(raw); continue;
    }
    skipped.push(raw);
  }
  return { state, applied, skipped };
}
