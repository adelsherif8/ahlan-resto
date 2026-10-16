import { useEffect, useState } from "react";
import { AlertTriangle, Store } from "lucide-react";
import { ops } from "./config";
import { Card, Empty, Badge, Stat, ago, full } from "./ui";
import { PLANS, suggestPlan, bill, egp, project, monthProgress, UNDERUSE_PCT, MIN_DAYS_TO_PROJECT, type PlanId } from "./pricing";

type PlanRow = {
  restaurant: string; name: string;
  plan: PlanId | null; plan_since: string | null; plan_notes?: string | null;
  branches: number | null;
  readable?: boolean; reason?: string;
  orders_mtd?: number; orders_billable?: number; orders_prev_month?: number | null;
  orders_7d?: number | null; orders_prev_7d?: number | null; server_now?: string;
  month_start?: string;
  by_status?: Record<string, number>;
  order_value_mtd?: number; order_value_billable?: number; aov?: number; capped?: boolean;
};
type Plans = { available: boolean; reason?: string; month_start?: string; restaurants: PlanRow[] };

/**
 * A cancelled order is neither billable nor a sale. Counts and money must come off the
 * same basis — mixing them (all-orders value ÷ billable count) overstated AOV.
 */
function billable(r: PlanRow) {
  if (typeof r.orders_billable === "number") return r.orders_billable;
  return Math.max(0, (r.orders_mtd || 0) - (r.by_status?.cancelled || 0));
}
function billableValue(r: PlanRow) {
  return typeof r.order_value_billable === "number" ? r.order_value_billable : (r.order_value_mtd || 0);
}

export default function PlansCard() {
  const [data, setData] = useState<Plans | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let alive = true;
    ops.get("/api/ops/plans")
      .then((r) => alive && setData(r.data))
      .catch((e) => {
        if (!alive) return;
        // the endpoint ships with the pending flows deploy — say so rather than
        // rendering an empty card that looks like "no restaurants"
        if (e?.response?.status === 404) setMissing(true);
        else setData({ available: false, reason: e?.message || "request failed", restaurants: [] });
      });
    return () => { alive = false; };
  }, []);

  if (missing) {
    return (
      <Card className="mb-4 p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-400" />
          <div className="text-sm">
            <div className="font-semibold">Plans & usage needs the pending flows deploy</div>
            <p className="mt-1 text-zinc-400">
              <code className="text-zinc-300">/api/ops/plans</code> is written and tested locally but isn't live yet — it ships with the rollup and health fixes.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  if (!data) return null;
  if (!data.available) {
    return (
      <Card className="mb-4 p-4 text-sm">
        <span className="font-semibold">Couldn't read orders.</span>{" "}
        <span className="text-zinc-400">{data.reason}</span>
      </Card>
    );
  }

  const rows = data.restaurants || [];
  const totalOrders = rows.reduce((s, r) => s + billable(r), 0);
  const totalValue = rows.reduce((s, r) => s + billableValue(r), 0);
  const totalBilled = rows.reduce((s, r) => {
    const plan = r.plan || suggestPlan(r.branches);
    return s + (plan ? bill(plan, billable(r)).total_egp : 0);
  }, 0);
  const avgAov = totalOrders ? totalValue / totalOrders : 0;
  const anyGuessed = rows.some((r) => !r.plan);

  return (
    <Card className="mb-4 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-4 py-2.5">
        <Store size={13} className="text-amber-400" />
        <span className="text-sm font-semibold">Plans & usage</span>
        <span className="text-[11px] text-zinc-500">
          month to date{data.month_start ? ` · since ${data.month_start.slice(0, 10)}` : ""} · billing is calendar-month, not the window above
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 p-3 md:grid-cols-4">
        <Stat label="billable orders" value={totalOrders.toLocaleString()} sub="cancelled excluded" />
        <Stat label="billed to restaurants" value={egp(totalBilled)} sub="plan fees + overage" />
        <Stat label="order value" value={egp(totalValue)} sub="guest spend, cancellations excluded" />
        <Stat label="avg order" value={egp(avgAov)} sub="real AOV — rate card assumes 150" />
      </div>

      {rows.length === 0 ? <Empty text="No restaurants." /> : (
        <div className="divide-y divide-zinc-800 border-t border-zinc-800">
          {rows.map((r) => <PlanRowView key={r.restaurant} r={r} monthStart={data.month_start} />)}
        </div>
      )}

      {anyGuessed && (
        <div className="border-t border-zinc-800 px-4 py-2 text-[10px] text-zinc-500">
          Plans marked <span className="text-amber-300">suggested</span> are inferred from branch count via the rate card's "fits" row — nobody has set an actual plan yet.
          Run migration <code className="text-zinc-400">032_control_billing_plan.sql</code> on the control DB, then set <code className="text-zinc-400">plan</code> per restaurant.
        </div>
      )}
    </Card>
  );
}

function PlanRowView({ r, monthStart }: { r: PlanRow; monthStart?: string }) {
  const planId = r.plan || suggestPlan(r.branches);
  const orders = billable(r);
  const cancelled = r.by_status?.cancelled || 0;
  const cancelRate = r.orders_mtd ? (cancelled / r.orders_mtd) * 100 : 0;
  const b = planId ? bill(planId, orders) : null;

  // where the month is going, not just where it stands
  const { daysInMonth, daysElapsed } = monthProgress(monthStart || r.month_start || new Date().toISOString(), r.server_now);
  const projected = project(orders, daysElapsed, daysInMonth);
  const projBill = planId && projected != null ? bill(planId, projected) : null;
  const perOrder = projBill && projected ? projBill.total_egp / projected : null;
  const underusing = projBill != null && projBill.used_pct < UNDERUSE_PCT;
  const overpacing = projBill != null && projBill.over;

  const w = r.orders_7d ?? null, pw = r.orders_prev_7d ?? null;
  const trend = w != null && pw != null ? w - pw : null;

  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-zinc-100">{r.name}</span>
        <span className="font-mono text-[10px] text-zinc-500">{r.restaurant}</span>
        {planId ? (
          <Badge tone={r.plan ? "amber" : "zinc"} title={r.plan ? PLANS[planId].fits : `no plan set — the rate card says ${PLANS[planId].fits}`}>
            {PLANS[planId].name}{r.plan ? "" : " · suggested"}
          </Badge>
        ) : (
          <Badge tone="red">no plan · no branch count</Badge>
        )}
        {r.branches != null && <span className="text-[11px] text-zinc-500">{r.branches} branch{r.branches === 1 ? "" : "es"}</span>}
        {b?.over && <Badge tone="red">over allowance</Badge>}
        {b?.near_limit && <Badge tone="amber">near limit</Badge>}
        {overpacing && !b?.over && <Badge tone="amber">on pace to exceed</Badge>}
        {underusing && <Badge tone="red" title="paying for far more than they use — the churn risk, not the billing one">underusing plan</Badge>}
        {w === 0 && pw != null && pw > 0 && <Badge tone="red">stopped ordering</Badge>}
        {r.readable === false && <Badge tone="red" title={r.reason}>orders unreadable</Badge>}
        {r.plan_since && <span className="text-[10px] text-zinc-600" title={full(r.plan_since)}>since {r.plan_since.slice(0, 10)}</span>}
        <span className="ml-auto text-sm font-semibold tabular-nums">{b ? egp(b.total_egp) : "—"}</span>
      </div>

      {b && (
        <>
          <div className="mt-2 flex items-center gap-2">
            <div className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-800">
              <div
                className={`h-full rounded-full ${b.over ? "bg-red-500" : b.near_limit ? "bg-amber-400" : "bg-amber-500/70"}`}
                style={{ width: `${Math.min(100, Math.max(1, b.used_pct))}%` }}
              />
              {/* the allowance line stays visible once usage runs past it */}
              {b.over && <div className="absolute inset-y-0 right-0 w-px bg-zinc-500" />}
            </div>
            <span className="shrink-0 text-[11px] tabular-nums text-zinc-400">
              {orders.toLocaleString()} / {b.included.toLocaleString()} orders · {b.used_pct.toFixed(b.used_pct < 10 ? 1 : 0)}%
            </span>
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-500">
            <span>{egp(b.plan.monthly_egp)}/mo</span>
            {b.overage_orders > 0
              ? <span className="text-red-300">+{b.overage_orders.toLocaleString()} over × {b.plan.overage_egp} EGP = {egp(b.overage_egp)}</span>
              : <span>{(b.included - orders).toLocaleString()} orders left before {b.plan.overage_egp} EGP each</span>}
            <span>AOV {egp(r.aov || 0)}</span>
            {cancelled > 0 && (
              <span title="excluded from the billable count" className={cancelRate >= 20 ? "text-red-300" : ""}>
                {cancelled} cancelled ({cancelRate.toFixed(0)}%)
              </span>
            )}
            {w != null && (
              <span title="billable orders, last 7 days vs the 7 before">
                7d {w}
                {pw != null && (
                  <>
                    {" vs "}{pw}
                    {trend !== null && trend !== 0 && (
                      <span className={trend > 0 ? "text-emerald-400" : "text-red-400"}> {trend > 0 ? "▲" : "▼"}{Math.abs(trend)}</span>
                    )}
                  </>
                )}
              </span>
            )}
            {r.orders_prev_month != null && <span>prev month {r.orders_prev_month.toLocaleString()}</span>}
            {r.capped && <span className="text-amber-400">order read capped — count is a floor</span>}
          </div>

          {/* the pace line: what this month lands at, and what an order is costing them */}
          <div className={`mt-1.5 rounded-lg px-2 py-1 text-[11px] ${
            underusing ? "bg-red-500/10 text-red-200" : overpacing ? "bg-amber-500/10 text-amber-200" : "bg-zinc-800/50 text-zinc-400"
          }`}>
            {projected == null ? (
              <>Day {Math.floor(daysElapsed)} of {daysInMonth} — too early to project (needs {MIN_DAYS_TO_PROJECT} days).</>
            ) : (
              <>
                On pace for <strong>~{projected.toLocaleString()}</strong> orders this month
                {projBill && <> — {projBill.used_pct < 1 ? "<1" : projBill.used_pct.toFixed(0)}% of the {b!.included.toLocaleString()} included</>}
                {projBill?.over && <> · <strong>{egp(projBill.overage_egp)} overage</strong> on top of {egp(b!.plan.monthly_egp)}</>}
                {perOrder != null && projected > 0 && <> · costs them <strong>{egp(perOrder)}</strong> per order</>}
                {underusing && <> · consider moving them down a plan before they do the maths</>}
                {overpacing && <> · time to move them up a plan</>}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
