import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, RefreshCw, CheckCircle2, XCircle, Info, ShoppingBag, Clock, Languages,
  Inbox, Rocket, Search, X, ChevronRight, ArrowLeft, Store, TrendingUp, Wallet,
} from "lucide-react";
import { ops } from "./config";
import { Card, Btn, Empty, Badge, Segments, Stat, Bar, ago, full, ms, usd } from "./ui";
import { PLANS, suggestPlan, bill, egp, money, EGP_PER_USD, type PlanId, type Currency } from "./pricing";
import { usePageVisible, useDebounced, useCurrency } from "./hooks";
import PlansCard from "./PlansCard";

type Win = { runs: number; errors: number; sessions: number; cost_usd: number; avg_ms: number; p95_ms: number; incomplete?: boolean };
type Mtd = {
  cost_usd: number; orders_all: number; orders_billable: number; value_billable: number; aov: number;
  // migration 034 — null means "not split yet", never zero
  cost_guest_usd: number | null; cost_test_usd: number | null;
  runs_guest: number | null; sessions_guest: number | null;
};
type RosterRow = {
  restaurant: string; name: string; plan: PlanId | null; branches: number | null;
  aggregated: boolean; window: Win; mtd: Mtd; dead_letters: number; handoffs_open: number;
  traces_from?: string | null; retention_days?: number;
};
type FirstReply = { samples: number; median_ms: number | null; p90_ms: number | null; worst_ms: number | null };
type DeadLetter = { phone_number: string; stage: string; error: string; created_at: string };
type Detail = {
  restaurant: string; name: string; window_days: number;
  sessions: number; sessions_converted: number; conversion_rate: number;
  orders: number; revenue_egp: number;
  guests: number; repeat_guests: number; repeat_rate: number;
  cost_usd: number; cost_per_order_usd: number | null;
  first_reply: FirstReply;
  languages: { ar: number; en: number; franco: number };
  orders_by_hour: number[]; orders_by_dow: number[];
  order_types: Record<string, number>;
  handoffs_open: number; ai_off: number;
  dead_letters: DeadLetter[];
  spend_by_flow: { flow: string; runs: number; errors: number; cost_usd: number; avg_ms: number; p95_ms: number }[];
  messages_sampled: number; messages_capped: boolean; language_sample: number;
};
type Insights = {
  available: boolean; reason?: string; mode: "all" | "detail";
  window_days: number; month_start: string; restaurants: RosterRow[]; detail: Detail | null;
};

type Boot = { id: number; service: string; started_at: string; env: string | null; note: string | null };
type Deploys = { available: boolean; reason?: string; window_days: number; boots: Boot[] };
type Check = { ok: boolean; level: "error" | "warn" | "info"; label: string; detail: string };
type Preflight = { available: boolean; reason?: string; restaurants: { restaurant: string; name: string; schema: string; failing: number; warning: number; checks: Check[] }[] };

const WINDOWS: [string, string][] = [["1", "24h"], ["7", "7 days"], ["30", "30 days"]];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Month-to-date P&L for one restaurant: revenue from the rate card, cost from model
 * spend. Both sides are MTD because the plans bill on calendar months — pairing a
 * 7-day cost with a monthly fee would invent a margin.
 */
function economics(r: RosterRow) {
  const planId = r.plan || suggestPlan(r.branches);
  const b = planId ? bill(planId, r.mtd.orders_billable) : null;
  const revenue = b?.total_egp ?? 0;

  // Cost of SERVING them, which is not the same as spend on their schema. On the pilot,
  // August was $78.81 of which $74.35 was our regression suite — charging that against
  // their plan described our R&D, not the business. Falls back to total spend when
  // migration 034 hasn't split it, and says which it used.
  const split = r.mtd.cost_guest_usd != null;
  const costUsd = split ? r.mtd.cost_guest_usd! : r.mtd.cost_usd;
  const cost = costUsd * EGP_PER_USD;
  const testUsd = r.mtd.cost_test_usd ?? 0;

  return {
    planId, bill: b, revenue, cost, costUsd, split,
    testEgp: testUsd * EGP_PER_USD, testUsd,
    profit: revenue - cost,
    margin: revenue > 0 ? ((revenue - cost) / revenue) * 100 : 0,
    // spend on their schema that isn't guests at all
    testHeavy: split ? testUsd > costUsd * 2 && testUsd > 1 : r.window.sessions === 0 && r.mtd.cost_usd > 1,
  };
}

type SortKey = "name" | "profit" | "revenue" | "cost" | "orders" | "runs" | "dead";

export default function InsightsView() {
  const [data, setData] = useState<Insights | null>(null);
  const [pf, setPf] = useState<Preflight | null>(null);
  const [deploys, setDeploys] = useState<Deploys | null>(null);
  const [days, setDays] = useState("7");
  const [selected, setSelected] = useState("");     // "" = all restaurants
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const [missing, setMissing] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("profit");
  const q = useDebounced(query, 200);
  const visible = usePageVisible();
  const [cur, setCur] = useCurrency();
  // amounts carry the unit they were measured in; conversion happens only here
  const m = (amount: number, unit: Currency, digits?: number) => money(amount, unit, cur, digits);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    setLoading(true);
    ops.get(`/api/ops/insights?days=${days}${selected ? `&restaurant=${encodeURIComponent(selected)}` : ""}`)
      .then((r) => alive && setData(r.data))
      .catch((e) => { if (alive && e?.response?.status === 404) setMissing(true); })
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [days, selected, tick, visible]);

  // these don't depend on the picker, so they load on their own
  useEffect(() => {
    if (!visible) return;
    ops.get("/api/ops/preflight").then((r) => setPf(r.data)).catch(() => {});
    ops.get(`/api/ops/deploys?days=${days}`).then((r) => setDeploys(r.data)).catch(() => {});
  }, [days, tick, visible]);

  const roster = data?.restaurants || [];
  const current = roster.find((r) => r.restaurant === selected) || null;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = needle
      ? roster.filter((r) => `${r.name} ${r.restaurant} ${r.plan || ""}`.toLowerCase().includes(needle))
      : roster;
    if (sort === "name") return [...rows].sort((a, b) => a.name.localeCompare(b.name));
    const rank = (r: RosterRow) => {
      const e = economics(r);
      return -({ profit: e.profit, revenue: e.revenue, cost: e.cost,
                 orders: r.mtd.orders_billable, runs: r.window.runs, dead: r.dead_letters }[sort] ?? 0);
    };
    return [...rows].sort((a, b) => rank(a) - rank(b));
  }, [roster, q, sort]);

  const totals = useMemo(() => filtered.reduce((a, r) => {
    const e = economics(r);
    a.revenue += e.revenue; a.cost += e.cost; a.profit += e.profit; a.test += e.testEgp;
    a.orders += r.mtd.orders_billable; a.value += r.mtd.value_billable;
    return a;
  }, { revenue: 0, cost: 0, profit: 0, test: 0, orders: 0, value: 0 }), [filtered]);

  // Rendered AFTER every hook has run. Sitting above the useMemos below, this early
  // return changed the hook count on the exact render it exists for (a 404), and React
  // threw instead of showing the card.
  if (missing) {
    return (
      <div className="p-6">
        <Card className="p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-400" />
            <div>
              <div className="font-semibold">Insights needs the pending flows deploy</div>
              <p className="mt-1 text-sm text-zinc-400">
                <code className="text-zinc-300">/api/ops/insights</code>, <code className="text-zinc-300">/api/ops/preflight</code> and <code className="text-zinc-300">/api/ops/deploys</code> are written and verified locally, but aren't live yet.
              </p>
            </div>
          </div>
        </Card>
      </div>
    );
  }


  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2">
          {selected && (
            <button onClick={() => setSelected("")} title="Back to all restaurants"
              className="rounded-lg border border-zinc-700 p-1.5 text-zinc-300 transition hover:bg-zinc-800">
              <ArrowLeft size={14} />
            </button>
          )}
          <div>
            <h2 className="text-lg font-bold">{current ? current.name : "Insights"}</h2>
            <p className="text-sm text-zinc-400">
              {current
                ? `${current.restaurant} · does the bot sell for them, and what do we make`
                : `${roster.length} restaurant${roster.length === 1 ? "" : "s"} · profit, spend, and where it went`}
            </p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Segments value={cur} onChange={setCur} options={[["EGP", "EGP"], ["USD", "USD"]]} />
          <Segments value={days} onChange={setDays} options={WINDOWS} />
          <Btn variant="ghost" onClick={() => setTick((x) => x + 1)}>
            <span className="flex items-center gap-1.5"><RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh</span>
          </Btn>
        </div>
      </div>

      {!data ? <Empty text="Loading…" /> : !data.available ? (
        <Card className="p-5 text-sm">
          <span className="font-semibold">Couldn't read the data.</span> <span className="text-zinc-400">{data.reason}</span>
        </Card>
      ) : (
        <div className={`space-y-5 transition-opacity ${loading ? "opacity-60" : ""}`}>
          {(() => {
            // If the oldest surviving trace is after the 1st, the janitor has already
            // deleted part of this month and every cost below is a floor. Verified the
            // hard way: $26.68 shown against a real $33.57 OpenAI bill for August.
            const cut = filtered.map((r) => r.traces_from).filter(Boolean).sort()[0];
            const ms = data.month_start;
            if (!cut || !ms || cut <= ms) return null;
            return (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                Costs below are a <strong>floor</strong>. Traces are purged after {filtered[0]?.retention_days ?? 14} days, so nothing before{" "}
                <strong>{String(cut).slice(0, 10)}</strong> survives and this month's earlier spend is missing. Check the provider's billing page for the real total.
              </div>
            );
          })()}

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat big label="billed to restaurants" value={m(totals.revenue, "EGP")} sub="plan fees + overage, month to date" />
            <Stat big label="cost to serve" value={m(totals.cost, "EGP")}
              sub={totals.test > 0
                ? `excludes ${m(totals.test, "EGP")} of our own test spend`
                : `converted at an assumed ${EGP_PER_USD} EGP/USD`} />
            <Stat big label="gross profit" value={m(totals.profit, "EGP")} bad={totals.profit < 0}
              sub={`${totals.revenue > 0 ? Math.round((totals.profit / totals.revenue) * 100) : 0}% margin · excludes WhatsApp fees`} />
            <Stat big label="orders" value={totals.orders.toLocaleString()} sub={`${m(totals.value, "EGP")} of guest spend`} />
          </div>

          {current ? (
            <>
              <EconomicsCard r={current} m={m} cur={cur} />
              {data.detail ? <DetailBlocks d={data.detail} m={m} /> : <Card><Empty text="No detail for this restaurant." /></Card>}
            </>
          ) : (
            <>
              <Roster rows={filtered} total={roster.length} query={query} setQuery={setQuery}
                sort={sort} setSort={setSort} onPick={setSelected} m={m} cur={cur} />
              {/* moved here from Cost: this is revenue, and Cost is now spend-only */}
              <PlansCard />
            </>
          )}

          <PreflightCard pf={pf} />
          <DeploysCard d={deploys} />
        </div>
      )}
    </div>
  );
}

/* ------------------------------ all restaurants ------------------------------ */

function Roster({ rows, total, query, setQuery, sort, setSort, onPick, m, cur }: {
  rows: RosterRow[]; total: number; query: string; setQuery: (v: string) => void;
  sort: SortKey; setSort: (k: SortKey) => void; onPick: (slug: string) => void;
  m: (a: number, u: Currency, d?: number) => string; cur: Currency;
}) {
  const H = ({ k, children, right }: { k: SortKey; children: React.ReactNode; right?: boolean }) => (
    <th className={`px-3 py-2 text-[10px] font-medium uppercase tracking-wide ${right ? "text-right" : "text-left"}`}>
      <button onClick={() => setSort(k)} className={`transition hover:text-amber-400 ${sort === k ? "text-amber-400" : ""}`}>
        {children}{sort === k ? " ↓" : ""}
      </button>
    </th>
  );

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-4 py-2.5">
        <Store size={13} className="text-amber-400" />
        <span className="text-sm font-semibold">Restaurants</span>
        <div className="relative ml-2">
          <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="search name, slug, plan…"
            className="w-56 rounded-lg border border-zinc-700 bg-zinc-900 py-1 pl-7 pr-6 text-xs text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-amber-500" />
          {query && (
            <button onClick={() => setQuery("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200">
              <X size={11} />
            </button>
          )}
        </div>
        <span className="text-[11px] text-zinc-500">{rows.length} of {total}</span>
        <span className="ml-auto text-[10px] text-zinc-500">click a row to drill in</span>
      </div>

      {rows.length === 0 ? <Empty text="No restaurant matches that." /> : (
        <div className="max-h-[28rem] overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-zinc-900 text-zinc-500">
              <tr className="border-b border-zinc-800">
                <H k="name">restaurant</H>
                <th className="px-3 py-2 text-left text-[10px] font-medium uppercase tracking-wide">plan</th>
                <H k="orders" right>orders</H>
                <H k="revenue" right>billed</H>
                <H k="cost" right>our cost</H>
                <H k="profit" right>profit</H>
                <th className="px-3 py-2 text-right text-[10px] font-medium uppercase tracking-wide">margin</th>
                <H k="runs" right>runs</H>
                <H k="dead" right>dead</H>
                <th className="w-6" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const e = economics(r);
                return (
                  <tr key={r.restaurant} onClick={() => onPick(r.restaurant)}
                    className="cursor-pointer border-b border-zinc-800/60 transition last:border-0 hover:bg-zinc-900">
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-semibold text-zinc-100">{r.name}</span>
                        <span className="font-mono text-[10px] text-zinc-500">{r.restaurant}</span>
                        {r.handoffs_open > 0 && <Badge tone="red">{r.handoffs_open} waiting</Badge>}
                        {e.testHeavy && <Badge tone="amber" title="spend with no guest conversations — this is our own regression traffic, not the cost of serving them">test traffic</Badge>}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {e.planId
                        ? <Badge tone={r.plan ? "amber" : "zinc"} title={r.plan ? PLANS[e.planId].fits : `no plan set — guessed from ${r.branches} branch(es)`}>
                            {PLANS[e.planId].name}{r.plan ? "" : "?"}
                          </Badge>
                        : <Badge tone="red">none</Badge>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-zinc-300">{r.mtd.orders_billable}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-zinc-300">{m(e.revenue, "EGP")}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-zinc-300">{m(e.cost, "EGP")}</td>
                    <td className={`px-3 py-2 text-right font-semibold tabular-nums ${e.profit < 0 ? "text-red-400" : "text-zinc-100"}`}>{m(e.profit, "EGP")}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <span className={`tabular-nums ${e.margin < 50 ? "text-amber-300" : "text-zinc-400"}`}>{Math.round(e.margin)}%</span>
                        <div className="w-10"><Bar pct={Math.max(0, e.margin)} tone={e.margin < 0 ? "red" : "amber"} /></div>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-zinc-400">
                      {r.window.runs.toLocaleString()}
                      {r.window.errors > 0 && <span className="ml-1 text-red-400">{r.window.errors}e</span>}
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums ${r.dead_letters > 0 ? "text-red-400" : "text-zinc-600"}`}>{r.dead_letters}</td>
                    <td className="pr-2 text-zinc-600"><ChevronRight size={12} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="border-t border-zinc-800 px-4 py-2 text-[10px] leading-relaxed text-zinc-500">
        Money is month-to-date. <span className="text-zinc-400">billed</span> = plan fee + overage from the rate card ·
        <span className="text-zinc-400"> our cost</span> = model spend{cur === "EGP" ? ` converted at ${EGP_PER_USD} EGP/USD` : ""} ·
        a plan shown with <span className="text-zinc-400">?</span> is guessed from branch count, not sold.
        WhatsApp per-message fees are not modelled here.
      </div>
    </Card>
  );
}

/* ------------------------------- one restaurant ------------------------------- */

function EconomicsCard({ r, m, cur }: { r: RosterRow; m: (a: number, u: Currency, d?: number) => string; cur: Currency }) {
  const e = economics(r);
  const plan = e.planId ? PLANS[e.planId] : null;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-4 py-2.5">
        <Wallet size={13} className="text-amber-400" />
        <span className="text-sm font-semibold">Economics</span>
        <span className="text-[11px] text-zinc-500">month to date</span>
        {plan && <Badge tone={r.plan ? "amber" : "zinc"}>{plan.name}{r.plan ? "" : " · suggested"}</Badge>}
        {e.testHeavy && <Badge tone="amber" title="no guest conversations in this window — the spend is our regression suite">mostly our own test traffic</Badge>}
      </div>
      <div className="grid grid-cols-2 gap-3 p-3 md:grid-cols-5">
        <Stat label="billed to them" value={m(e.revenue, "EGP")}
          sub={plan ? `${m(plan.monthly_egp, "EGP")} plan${e.bill?.overage_egp ? ` + ${m(e.bill.overage_egp, "EGP")} over` : ""}` : "no plan set"} />
        <Stat label="cost to serve them" value={m(e.costUsd, "USD")}
          sub={e.split ? "guest traffic only" : "all traffic (run 034 to split)"}
          hint={e.split ? "model spend on guest sessions, excluding our regression suite and test chat" : "migration 034 not run — this includes our own test traffic, so the margin below flatters"} />
        <Stat label="gross profit" value={m(e.profit, "EGP")} bad={e.profit < 0} sub={`${Math.round(e.margin)}% margin`} />
        <Stat label="orders" value={String(r.mtd.orders_billable)} sub={`${m(r.mtd.value_billable, "EGP")} guest spend`} />
        <Stat label="avg order" value={m(r.mtd.aov, "EGP")} sub="cancellations excluded" />
      </div>
      {e.split && e.testUsd > 0 && (
        <div className="border-t border-zinc-800 px-4 py-2 text-[11px] text-zinc-500">
          Excluded from the cost above: <span className="text-amber-300">{m(e.testUsd, "USD")}</span> of our own
          regression-suite and test-chat spend on this restaurant's schema — real, already paid, but not the cost of serving them.
        </div>
      )}
    </Card>
  );
}

function DetailBlocks({ d, m }: { d: Detail; m: (a: number, u: Currency, dg?: number) => string }) {
  const fr = d.first_reply;
  const langTotal = d.languages.ar + d.languages.en + d.languages.franco;
  const spendTotal = Math.max(1e-9, d.spend_by_flow.reduce((s, f) => s + f.cost_usd, 0));

  return (
    <>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-4 py-2.5">
          <TrendingUp size={13} className="text-amber-400" />
          <span className="text-sm font-semibold">Performance</span>
          <span className="text-[11px] text-zinc-500">last {d.window_days === 1 ? "24h" : `${d.window_days} days`}</span>
          {d.handoffs_open > 0 && <Badge tone="red">{d.handoffs_open} waiting for a human</Badge>}
          {d.ai_off > 0 && <Badge tone="amber">{d.ai_off} AI switched off</Badge>}
        </div>
        <div className="grid grid-cols-2 gap-3 p-3 md:grid-cols-4">
          <Stat big label="conversion" value={`${d.conversion_rate}%`}
            sub={`${d.sessions_converted} of ${d.sessions} conversations ordered`}
            hint="matched on phone: a conversation counts as converted if that guest ordered within the window" />
          <Stat big label="cost per order" value={d.cost_per_order_usd == null ? "—" : m(d.cost_per_order_usd, "USD")}
            sub={d.cost_per_order_usd == null ? "no orders yet" : "model spend ÷ orders"} />
          <Stat big label="first reply" value={fr.median_ms == null ? "—" : ms(fr.median_ms)}
            sub={fr.median_ms == null ? "no exchanges" : `p90 ${ms(fr.p90_ms)} · worst ${ms(fr.worst_ms)}`}
            hint="guest's first message → the bot's reply, merge window included. What the guest actually feels." />
          <Stat big label="repeat guests" value={`${d.repeat_rate}%`} sub={`${d.repeat_guests} of ${d.guests} ordered twice or more`} />
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2.5">
          <Wallet size={13} className="text-amber-400" />
          <span className="text-sm font-semibold">Where the spend went</span>
          <span className="ml-auto text-[11px] tabular-nums text-zinc-500">
            {m(d.cost_usd, "USD")} over {d.window_days === 1 ? "24h" : `${d.window_days}d`}
          </span>
        </div>
        {d.spend_by_flow.length === 0 ? <Empty text="No runs in this window." /> : (
          <div className="divide-y divide-zinc-800/60">
            {d.spend_by_flow.map((f) => (
              <div key={f.flow} className="px-4 py-2">
                <div className="flex items-center gap-3 text-xs">
                  <span className="w-20 shrink-0 font-semibold text-amber-400">{f.flow}</span>
                  <span className="flex-1 text-right tabular-nums text-zinc-500">
                    {f.runs.toLocaleString()} runs · avg {ms(f.avg_ms)}
                    {f.errors > 0 && <span className="text-red-400"> · {f.errors} err</span>}
                  </span>
                  <span className="w-20 shrink-0 text-right tabular-nums text-zinc-200">{m(f.cost_usd, "USD")}</span>
                  <span className="w-9 shrink-0 text-right tabular-nums text-zinc-500">{Math.round((f.cost_usd / spendTotal) * 100)}%</span>
                </div>
                <div className="mt-1"><Bar pct={(f.cost_usd / spendTotal) * 100} tone={f.errors ? "red" : "amber"} /></div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="p-3">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-zinc-300">
            <Languages size={12} className="text-amber-400" /> Language
            <span className="ml-auto font-normal text-zinc-500">{d.language_sample} guest messages</span>
          </div>
          {langTotal === 0 ? <div className="text-[11px] text-zinc-500">No guest messages.</div> : (
            <div className="space-y-1.5">
              {([["ar", "Arabic"], ["en", "English"], ["franco", "Franco"]] as const).map(([k, label]) => (
                <div key={k}>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-zinc-400">{label}</span>
                    <span className="tabular-nums text-zinc-300">{Math.round((d.languages[k] / langTotal) * 100)}% · {d.languages[k]}</span>
                  </div>
                  <Bar pct={(d.languages[k] / langTotal) * 100} />
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-3">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-zinc-300">
            <ShoppingBag size={12} className="text-amber-400" /> Order mix
            <span className="ml-auto font-normal text-zinc-500">{d.orders} · {m(d.revenue_egp, "EGP")}</span>
          </div>
          {d.orders === 0 ? <div className="text-[11px] text-zinc-500">No orders in this window.</div> : (
            <div className="space-y-1.5">
              {Object.entries(d.order_types).sort((a, b) => b[1] - a[1]).map(([type, n]) => (
                <div key={type}>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-zinc-400">{type.replace(/_/g, " ")}</span>
                    <span className="tabular-nums text-zinc-300">{Math.round((n / d.orders) * 100)}% · {n}</span>
                  </div>
                  <Bar pct={(n / d.orders) * 100} tone="sky" />
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-3">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-zinc-300">
            <Clock size={12} className="text-amber-400" /> When they order
            <span className="ml-auto font-normal text-zinc-500">UTC</span>
          </div>
          <HourStrip counts={d.orders_by_hour} />
          <div className="mt-2 flex gap-0.5">
            {d.orders_by_dow.map((n, i) => {
              const max = Math.max(1, ...d.orders_by_dow);
              return (
                <div key={i} className="min-w-0 flex-1 text-center" title={`${DOW[i]}: ${n} orders`}>
                  <div className="mx-auto h-7 w-full rounded-sm bg-zinc-800/60">
                    <div className="w-full rounded-sm bg-amber-500/45"
                      style={{ height: `${(n / max) * 100}%`, marginTop: `${100 - (n / max) * 100}%` }} />
                  </div>
                  <div className="mt-0.5 text-[9px] text-zinc-500">{DOW[i][0]}</div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2.5">
          <Inbox size={13} className="text-amber-400" />
          <span className="text-sm font-semibold">Dead letters</span>
          <span className="text-[11px] text-zinc-500">messages the pipeline failed to answer · newest 50</span>
        </div>
        {d.dead_letters.length === 0 ? <Empty text="None in this window — every message got a reply." /> : (
          <div className="max-h-72 divide-y divide-zinc-800/60 overflow-y-auto">
            {d.dead_letters.map((x, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 px-4 py-2 text-xs">
                <span className="font-mono text-zinc-300">{x.phone_number}</span>
                <Badge>{x.stage}</Badge>
                <span className="min-w-0 flex-1 truncate text-red-300" title={x.error}>{x.error}</span>
                <span className="shrink-0 text-zinc-500" title={full(x.created_at)}>{ago(x.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {d.messages_capped && (
        <div className="text-[10px] text-amber-400">
          Message read hit its cap — first-reply timings come from the most recent {d.messages_sampled.toLocaleString()} messages only.
        </div>
      )}
    </>
  );
}

function HourStrip({ counts }: { counts: number[] }) {
  const max = Math.max(1, ...counts);
  return (
    <>
      <div className="flex gap-px">
        {counts.map((n, h) => (
          <div key={h} title={`${String(h).padStart(2, "0")}:00 UTC — ${n} order${n === 1 ? "" : "s"}`}
            className="h-7 min-w-0 flex-1 rounded-sm"
            style={{ backgroundColor: n === 0 ? "rgb(39 39 42)" : `rgba(245,158,11,${0.15 + 0.6 * (n / max)})` }} />
        ))}
      </div>
      <div className="mt-0.5 flex justify-between text-[9px] text-zinc-500">
        <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
      </div>
    </>
  );
}

function DeploysCard({ d }: { d: Deploys | null }) {
  if (!d) return null;
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-4 py-2.5">
        <Rocket size={13} className="text-amber-400" />
        <span className="text-sm font-semibold">Deploys</span>
        <span className="text-[11px] text-zinc-500">
          {d.available
            ? `${d.boots.length} flows restart${d.boots.length === 1 ? "" : "s"} in the last ${d.window_days} days`
            : "needs migration 033 — nothing records restarts yet"}
        </span>
      </div>
      {!d.available ? (
        <div className="px-4 py-3 text-[11px] text-zinc-500">
          Run <code className="text-zinc-400">migration 033</code> (control DB section) and flows records one row per boot. Database said: {d.reason}
        </div>
      ) : d.boots.length === 0 ? <Empty text="No restarts recorded in this window." /> : (
        <div className="max-h-56 divide-y divide-zinc-800/60 overflow-y-auto">
          {d.boots.map((b) => (
            <div key={b.id} className="flex items-center gap-2 px-4 py-1.5 text-xs">
              <Badge tone={b.env === "production" ? "amber" : "zinc"}>{b.env || "?"}</Badge>
              <span className="font-mono text-zinc-300">{b.service}</span>
              {b.note && <span className="min-w-0 flex-1 truncate text-zinc-500">{b.note}</span>}
              <span className="ml-auto shrink-0 text-zinc-500" title={full(b.started_at)}>{ago(b.started_at)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function PreflightCard({ pf }: { pf: Preflight | null }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!pf) return null;
  if (!pf.available) {
    return <Card className="p-4 text-sm"><span className="font-semibold">Pre-flight unavailable.</span> <span className="text-zinc-400">{pf.reason}</span></Card>;
  }
  const needsWork = pf.restaurants.filter((r) => r.failing > 0 || r.warning > 0).length;
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2.5">
        <AlertTriangle size={13} className="text-amber-400" />
        <span className="text-sm font-semibold">Restaurant pre-flight</span>
        <span className="text-[11px] text-zinc-500">
          config that would break for a real guest — {needsWork} of {pf.restaurants.length} need attention
        </span>
      </div>
      <div className="max-h-96 divide-y divide-zinc-800 overflow-y-auto">
        {pf.restaurants.map((r) => {
          const isOpen = open === r.restaurant;
          const clean = r.failing === 0 && r.warning === 0;
          return (
            <div key={r.restaurant}>
              <button onClick={() => setOpen(isOpen ? null : r.restaurant)}
                className="flex w-full flex-wrap items-center gap-2 px-4 py-2.5 text-left transition hover:bg-zinc-900">
                {clean ? <CheckCircle2 size={14} className="text-emerald-400" />
                  : r.failing ? <XCircle size={14} className="text-red-400" />
                  : <AlertTriangle size={14} className="text-amber-400" />}
                <span className="text-sm font-semibold">{r.name}</span>
                <span className="font-mono text-[10px] text-zinc-500">{r.schema}</span>
                {r.failing > 0 && <Badge tone="red">{r.failing} broken</Badge>}
                {r.warning > 0 && <Badge tone="amber">{r.warning} to look at</Badge>}
                {clean && <Badge tone="emerald">all clear</Badge>}
                <span className="ml-auto text-[10px] text-zinc-500">{isOpen ? "hide" : "details"}</span>
              </button>
              {isOpen && (
                <div className="bg-zinc-950/40 px-4 py-2">
                  {r.checks.map((c, i) => (
                    <div key={i} className="flex items-center gap-2 py-0.5 text-[11px]">
                      {c.ok ? <CheckCircle2 size={11} className="shrink-0 text-emerald-400" />
                        : c.level === "error" ? <XCircle size={11} className="shrink-0 text-red-400" />
                        : c.level === "warn" ? <AlertTriangle size={11} className="shrink-0 text-amber-400" />
                        : <Info size={11} className="shrink-0 text-zinc-500" />}
                      <span className={c.ok ? "text-zinc-400" : "text-zinc-200"}>{c.label}</span>
                      <span className="ml-auto text-right text-zinc-500">{c.detail}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
