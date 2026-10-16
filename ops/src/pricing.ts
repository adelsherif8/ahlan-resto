/**
 * The published rate card — source of truth `branding/pricing.md` (approved 2026-08-13).
 *
 * It lives in the console, not in flows, on purpose: prices change more often than the
 * agent does, and a price change should cost a static redeploy rather than a deploy of
 * the service that talks to guests. flows only returns facts (orders, branches, value);
 * every number below is applied here.
 */
export type PlanId = "start" | "grow" | "chain";

export const PLANS: Record<PlanId, {
  id: PlanId; name: string; monthly_egp: number; included_orders: number;
  overage_egp: number; fits: string; branch_range: [number, number];
}> = {
  start: { id: "start", name: "Start", monthly_egp: 3500, included_orders: 300, overage_egp: 9, fits: "one branch", branch_range: [1, 1] },
  grow: { id: "grow", name: "Grow", monthly_egp: 8500, included_orders: 1000, overage_egp: 8, fits: "one busy branch or 2–3 branches", branch_range: [2, 3] },
  chain: { id: "chain", name: "Chain", monthly_egp: 20000, included_orders: 2500, overage_egp: 7, fits: "4–10 branches", branch_range: [4, 10] },
};

export const PLAN_ORDER: PlanId[] = ["start", "grow", "chain"];
export const SETUP_EGP = 2500;
export const EXTRA_BRANCH_EGP = 1500;

/** Flag a restaurant before it blows past its allowance, not after. */
export const NEAR_LIMIT = 0.8;

/**
 * Only used to put our USD model spend next to EGP revenue. It is an ASSUMPTION, not a
 * live rate — it is shown in the UI wherever it's applied so no one mistakes it for one.
 */
export const EGP_PER_USD = 50;

/**
 * There is no plan column on `restaurants`, so until someone sets basic_info.billing.plan
 * this is the rate card's own "Fits" row read backwards from branch count. It is a
 * SUGGESTION and must always be labelled as one — a busy single branch belongs on Grow,
 * and only the person who sold the deal knows that.
 */
export function suggestPlan(branches: number | null): PlanId | null {
  if (!branches || branches < 1) return null;
  if (branches === 1) return "start";
  if (branches <= 3) return "grow";
  return "chain";
}

/**
 * A month-end projection from a couple of days of data is noise, not a forecast —
 * one order on day 2 would "project" to fifteen. Below this, say so instead.
 */
export const MIN_DAYS_TO_PROJECT = 5;

/** Under this share of the allowance, the restaurant is paying for room it never uses. */
export const UNDERUSE_PCT = 30;

/**
 * Pace, not level. 75% of the allowance on day 28 is fine; 75% on day 8 finishes at
 * triple. Everything worth alerting on comes from the projected month-end number.
 */
export function project(billableOrders: number, daysElapsed: number, daysInMonth: number) {
  if (daysElapsed < MIN_DAYS_TO_PROJECT) return null;
  return Math.round((billableOrders / daysElapsed) * daysInMonth);
}

export function monthProgress(monthStartIso: string, nowIso?: string) {
  const start = new Date(monthStartIso);
  const now = nowIso ? new Date(nowIso) : new Date();
  const daysInMonth = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  const daysElapsed = Math.max(0.5, (now.getTime() - start.getTime()) / 86400_000);
  return { daysInMonth, daysElapsed: Math.min(daysElapsed, daysInMonth) };
}

export function egp(n: number, digits = 0) {
  return `${n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })} EGP`;
}

// ---------------------------------------------------------------------------
// Currency display. Revenue is naturally EGP (the rate card) and model spend is
// naturally USD (what the provider bills), so every figure carries the unit it was
// measured in and is converted only for display — never stored converted, and never
// added together in mixed units.
// ---------------------------------------------------------------------------
export type Currency = "EGP" | "USD";

export function convert(amount: number, from: Currency, to: Currency) {
  if (from === to) return amount;
  return to === "USD" ? amount / EGP_PER_USD : amount * EGP_PER_USD;
}

/**
 * Format `amount` (given in `unit`) for display in `show`.
 * Digits default to what the magnitude deserves: EGP is a whole-number currency here,
 * USD needs decimals or a $1.57 spend renders as "$2".
 */
export function money(amount: number, unit: Currency, show: Currency, digits?: number) {
  const v = convert(amount, unit, show);
  if (show === "EGP") {
    const d = digits ?? (Math.abs(v) < 10 && v !== 0 ? 1 : 0);
    return `${v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })} EGP`;
  }
  const d = digits ?? (Math.abs(v) < 1 ? 4 : Math.abs(v) < 100 ? 2 : 0);
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}

/** What a restaurant owes this month for the orders it actually put through. */
export function bill(plan: PlanId, billableOrders: number) {
  const p = PLANS[plan];
  const overage = Math.max(0, billableOrders - p.included_orders);
  return {
    plan: p,
    included: p.included_orders,
    overage_orders: overage,
    overage_egp: overage * p.overage_egp,
    total_egp: p.monthly_egp + overage * p.overage_egp,
    used_pct: (billableOrders / p.included_orders) * 100,
    near_limit: billableOrders >= p.included_orders * NEAR_LIMIT && overage === 0,
    over: overage > 0,
  };
}
