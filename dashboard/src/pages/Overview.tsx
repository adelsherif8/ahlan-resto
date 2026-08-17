import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, Bot, Store, TrendingUp, TrendingDown, CheckCircle2, UtensilsCrossed, Bike, ShoppingBag, Activity, Clock, Info } from "lucide-react";
import { api } from "../config/api";
import { Card, PageHeader, Pill, Empty } from "../components/ui";

import { money } from "../lib/format";
import { usePoll } from "../lib/usePoll";

// Overview = the one screen a manager reads in ten seconds. Three rules hold it together:
//
//  1) NEVER STATE A NUMBER YOU CAN'T STAND BEHIND. Percentages off a handful of orders are
//     noise dressed as signal, so every comparison is suppressed below MIN_SAMPLE and says
//     why. Same for the forecast: one weekday on record is not a forecast.
//  2) ALERTS EARN THEIR RED. "Late" is measured against this kitchen's own prep time, not a
//     hardcoded 20 minutes, and tickets nobody ever closed are a chore, not an emergency —
//     an alarm that can never be cleared teaches staff to ignore every alarm.
//  3) SPACE FOLLOWS CONTENT. A panel with nothing in it collapses to one line instead of
//     holding a full-height empty box.
//
// Colour discipline: the brand accent carries identity only (hero figure, "now" marker).
// Status uses fixed semantic colours, and never colour alone — every up/down and every
// alert also carries an icon and a word, so it survives greyscale and colour blindness.

const MIN_SAMPLE = 5;      // below this, comparisons are noise — show the count, not a %
const STALE_HOURS = 12;    // an open ticket older than this is bookkeeping, not service
const RANGES: { k: number; label: string }[] = [
  { k: 1, label: "Today" },
  { k: 7, label: "7 days" },
  { k: 30, label: "30 days" },
];

const dayOf = (ts: any) => new Date(ts).toLocaleDateString("en-CA");
const isLive = (o: any) => !["paid", "cancelled", "served", "delivered"].includes(o.status);
const ageMin = (ts: any) => (Date.now() - new Date(ts).getTime()) / 60000;

export default function Overview() {
  const [kpis, setKpis] = useState<any | null>(null);
  const [agent, setAgent] = useState<any | null>(null);
  const [guests, setGuests] = useState<any[]>([]);
  const [rtype, setRtype] = useState<string>("fine");
  const [sampleCount, setSampleCount] = useState(0);
  const [orders, setOrders] = useState<any[]>([]);
  const [menuItems, setMenuItems] = useState<any[]>([]);
  const [range, setRange] = useState(1);

  useEffect(() => {
    api.get("/api/diners").then((r) => setGuests(r.data || [])).catch(() => {});
    api.get("/api/settings").then((r) => setRtype(r.data?.basic_info?.restaurant_type || "fine")).catch(() => {});
    api.get("/api/menu").then((r) => {
      setMenuItems(r.data || []);
      setSampleCount((r.data || []).filter((m: any) =>
        (m.options || []).some((g: any) => g.sample || (g.choices || []).some((c: any) => c.sample))).length);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    api.get("/api/dashboard/agent-stats").then((r) => setAgent(r.data)).catch(() => {});
  }, []);
  usePoll(() => {
    api.get("/api/dashboard/kpis").then((r) => setKpis(r.data)).catch(() => {});
    api.get("/api/orders", { params: { since_days: 62 } }).then((r) => setOrders(r.data || [])).catch(() => {});
  }, 15000);

  if (!kpis) return <Empty text="Loading…" />;
  const casual = rtype === "casual";
  const O = kpis.orders_today || {};

  // ---- live board state, computed from orders so the strip and the tiles never disagree.
  // Prep time is measured, not assumed: "late" is 1.5× what this kitchen actually takes.
  const preps = orders
    .map((o) => { const end = o.ready_at || o.served_at; return end ? (new Date(end).getTime() - new Date(o.created_at).getTime()) / 60000 : null; })
    .filter((x): x is number => x !== null && x > 0 && x < 240)
    .sort((a, b) => a - b);
  const medianPrep = preps.length >= 5 ? preps[Math.floor(preps.length / 2)] : null;
  const lateAfter = medianPrep ? Math.max(20, Math.round(medianPrep * 1.5)) : 20;

  const liveAll = orders.filter(isLive);
  const openNow = liveAll.filter((o) => ageMin(o.created_at) <= STALE_HOURS * 60);
  const staleOpen = liveAll.length - openNow.length;
  const lateNow = openNow.filter((o) => ageMin(o.created_at) > lateAfter).length;

  // Urgent (someone is waiting) is kept apart from housekeeping (do it when you can) —
  // mixing them is what makes a strip of red banners meaningless.
  const urgent: { text: string; to: string }[] = [];
  const chores: { text: string; to: string }[] = [];
  if (lateNow > 0) urgent.push({ text: `${lateNow} order${lateNow > 1 ? "s" : ""} past ${lateAfter} min${medianPrep ? " (your usual prep × 1.5)" : ""}`, to: "/orders?filter=late" });
  if (kpis.needs_attention > 0) urgent.push({ text: `${kpis.needs_attention} conversation${kpis.needs_attention > 1 ? "s" : ""} waiting on a human`, to: "/chats?filter=attention" });
  if (staleOpen > 0) chores.push({ text: `${staleOpen} ticket${staleOpen > 1 ? "s" : ""} left open from earlier days — close them to clear the board`, to: "/orders" });
  if (sampleCount > 0) chores.push({ text: `${sampleCount} menu item${sampleCount > 1 ? "s" : ""} still ha${sampleCount > 1 ? "ve" : "s"} unverified prices`, to: "/menu" });

  const today = new Date().toLocaleDateString("en-CA");
  const todaysOrders = orders.filter((o) => dayOf(o.created_at) === today && o.status !== "cancelled");
  // stock pace: tracked items projected to run out before close, at today's rate
  const soldToday: Record<string, number> = {};
  for (const o of todaysOrders) for (const i of o.items || []) soldToday[i.name] = (soldToday[i.name] || 0) + Number(i.qty || 1);
  const firstAt = todaysOrders.length ? new Date(todaysOrders[todaysOrders.length - 1].created_at).getTime() : 0;
  const hoursSoFar = firstAt ? Math.max(0.5, (Date.now() - firstAt) / 3600000) : 0;
  for (const m of menuItems) {
    if (m.stock_count == null || m.stock_count <= 0 || !hoursSoFar) continue;
    const rate = (soldToday[m.name] || 0) / hoursSoFar;
    if (rate <= 0) continue;
    const runout = new Date(Date.now() + (m.stock_count / rate) * 3600000);
    if (runout.getDate() === new Date().getDate())
      urgent.push({ text: `${m.name}: ${m.stock_count} left — runs out ~${runout.getHours()}:${String(runout.getMinutes()).padStart(2, "0")} at this pace`, to: "/menu" });
  }
  const discToday = todaysOrders.reduce((s, o) => s + (Number(o.discount) || 0), 0);
  const revToday = todaysOrders.reduce((s, o) => s + (Number(o.total) || 0), 0);
  if (revToday > 0 && discToday / revToday > 0.1 && todaysOrders.length >= MIN_SAMPLE)
    chores.push({ text: `Discounts are ${Math.round((discToday / revToday) * 100)}% of today's revenue (EGP ${money(discToday)}) — check the Z report`, to: "/pos" });
  const cancToday = orders.filter((o) => dayOf(o.created_at) === today && o.status === "cancelled");
  if (cancToday.length >= 3) urgent.push({ text: `${cancToday.length} cancellations today (EGP ${money(cancToday.reduce((s, o) => s + (Number(o.total) || 0), 0))}) — look for a pattern`, to: "/orders" });

  return (
    <div>
      <PageHeader
        title="Overview"
        subtitle={casual ? "Today at a glance" : "Tonight at a glance"}
        actions={casual ? (
          <div className="flex rounded-xl border border-zinc-800 p-0.5" role="group" aria-label="Time range">
            {RANGES.map((r) => (
              <button key={r.k} onClick={() => setRange(r.k)} aria-pressed={range === r.k}
                className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium transition ${range === r.k ? "text-[var(--accent-contrast)]" : "text-zinc-400 hover:text-zinc-200"}`}
                style={range === r.k ? { backgroundColor: "var(--accent)" } : undefined}>
                {r.label}
              </button>
            ))}
          </div>
        ) : undefined}
      />

      {casual ? (
        <CasualBoard O={O} kpis={kpis} orders={orders} menuItems={menuItems} range={range}
          urgent={urgent} chores={chores} openNow={openNow.length} lateNow={lateNow} />
      ) : (
        <>
          <AlertStrip urgent={urgent} chores={chores} />
          <FineBoard kpis={kpis} agent={agent} />
        </>
      )}

      <GuestsCard guests={guests} />

      {!casual && <FineBottom kpis={kpis} />}
    </div>
  );
}

// Two tiers, each labelled in words. Colour is reinforcement here, never the only signal.
function AlertStrip({ urgent, chores }: { urgent: any[]; chores: any[] }) {
  if (!urgent.length && !chores.length)
    return (
      <div className="mb-5 flex items-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-2.5 text-sm text-zinc-300">
        <CheckCircle2 size={15} className="shrink-0 text-emerald-400" aria-hidden="true" />
        All clear — no late orders, no stuck chats, nothing waiting on you.
      </div>
    );
  return (
    <div className="mb-5 space-y-1.5">
      {urgent.map((n, i) => (
        <Link key={`u${i}`} to={n.to}
          className="flex cursor-pointer items-center gap-2 rounded-2xl border border-red-500/50 bg-red-500/10 px-4 py-2.5 text-sm text-zinc-100 transition hover:brightness-125">
          <AlertCircle size={15} className="shrink-0 text-red-400" aria-hidden="true" />
          <span className="shrink-0 rounded-md bg-red-500/20 px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-red-300">Now</span>
          <span className="flex-1">{n.text}</span>
          <span className="text-xs text-zinc-500">open</span>
        </Link>
      ))}
      {chores.map((n, i) => (
        <Link key={`c${i}`} to={n.to}
          className="flex cursor-pointer items-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-900/60 px-4 py-2 text-sm text-zinc-300 transition hover:border-zinc-600">
          <Info size={14} className="shrink-0 text-zinc-500" aria-hidden="true" />
          <span className="shrink-0 rounded-md bg-zinc-800 px-1.5 py-0.5 text-xs font-medium uppercase tracking-wide text-zinc-400">When you can</span>
          <span className="flex-1">{n.text}</span>
          <span className="text-xs text-zinc-600">open</span>
        </Link>
      ))}
    </div>
  );
}

// ---------------- casual: orders-first ----------------

function CasualBoard({ O, kpis, orders, menuItems, range, urgent, chores, openNow, lateNow }: any) {
  const now = Date.now();
  const startMs = range === 1 ? new Date(new Date().setHours(0, 0, 0, 0)).getTime() : now - range * 86400000;
  const spanMs = now - startMs;
  const kept = (orders || []).filter((o: any) => new Date(o.created_at).getTime() >= startMs && o.status !== "cancelled");

  // Baseline: for Today it's the same weekday a week ago (a Friday only means something
  // next to a Friday); for a multi-day window it's the window immediately before it.
  const weekday = new Date().toLocaleDateString("en", { weekday: "long" });
  const prev = range === 1
    ? (orders || []).filter((o: any) => dayOf(o.created_at) === dayOf(now - 7 * 86400000) && o.status !== "cancelled")
    : (orders || []).filter((o: any) => {
        const t = new Date(o.created_at).getTime();
        return t >= startMs - spanMs && t < startMs && o.status !== "cancelled";
      });
  const baselineLabel = range === 1 ? `vs last ${weekday}` : `vs previous ${range} days`;

  const sum = (xs: any[]) => xs.reduce((s: number, o: any) => s + (Number(o.total) || 0), 0);
  const revenue = sum(kept);
  const prevRevenue = sum(prev);
  const enough = kept.length >= MIN_SAMPLE && prev.length >= MIN_SAMPLE;
  const delta = enough && prevRevenue > 0 ? Math.round(((revenue - prevRevenue) / prevRevenue) * 100) : null;
  const tooFew = enough ? null : `${kept.length} order${kept.length === 1 ? "" : "s"} — too few to compare`;

  const avgTicket = kept.length ? Math.round(revenue / kept.length) : 0;
  const prevAvgTicket = prev.length ? Math.round(prevRevenue / prev.length) : 0;
  const aiCount = kept.filter((o: any) => !String(o.phone_number || "").startsWith("walkin:")).length;
  const aiPct = kept.length ? Math.round((aiCount / kept.length) * 100) : null;

  // ---- food cost: the half of prime cost we can actually prove. Items with no recorded
  // cost are excluded and reported, never estimated — see the Profit page for the breakdown.
  const key = (s: any) => String(s || "").trim().toLowerCase();
  const costOf = new Map<string, number | null>(
    (menuItems || []).map((m: any): [string, number | null] => [key(m.name), m.cost == null || m.cost === "" ? null : Number(m.cost)])
  );
  let costedRev = 0, foodCost = 0, uncostedRev = 0;
  for (const o of kept) for (const it of o.items || []) {
    const q = Number(it.qty) || 1;
    const rev = (Number(it.unit_price ?? it.price) || 0) * q;
    const c = costOf.get(key(it.name));
    if (c != null && Number.isFinite(c)) { costedRev += rev; foodCost += c * q; } else uncostedRev += rev;
  }
  const foodCostPct = costedRev > 0 ? Math.round((foodCost / costedRev) * 100) : null;
  const coverage = costedRev + uncostedRev > 0 ? Math.round((costedRev / (costedRev + uncostedRev)) * 100) : 0;

  // ---- series: hours within a day, days across a window
  const series: { label: string; value: number; count: number; isNow?: boolean }[] = [];
  if (range === 1) {
    const byHour: Record<number, { egp: number; n: number }> = {};
    for (const o of kept) { const h = new Date(o.created_at).getHours(); byHour[h] = byHour[h] || { egp: 0, n: 0 }; byHour[h].egp += Number(o.total) || 0; byHour[h].n++; }
    const hs = Object.keys(byHour).map(Number).sort((a, b) => a - b);
    const nowH = new Date().getHours();
    for (const h of hs) series.push({ label: `${String(h).padStart(2, "0")}`, value: byHour[h].egp, count: byHour[h].n, isNow: h === nowH });
  } else {
    const byDay: Record<string, { egp: number; n: number }> = {};
    for (let i = range - 1; i >= 0; i--) byDay[dayOf(now - i * 86400000)] = { egp: 0, n: 0 };
    for (const o of kept) { const d = dayOf(o.created_at); if (byDay[d]) { byDay[d].egp += Number(o.total) || 0; byDay[d].n++; } }
    for (const [d, v] of Object.entries(byDay)) series.push({ label: d.slice(5), value: v.egp, count: v.n, isNow: d === dayOf(now) });
  }

  // ---- peak-window hint, from this weekday over the last 4 weeks
  const peak = (() => {
    const days = new Set<string>();
    const byHour: Record<number, number> = {};
    for (const o of orders || []) {
      const t = new Date(o.created_at);
      if (t.getDay() !== new Date().getDay() || t.getTime() < now - 28 * 86400000 || o.status === "cancelled") continue;
      days.add(dayOf(o.created_at));
      byHour[t.getHours()] = (byHour[t.getHours()] || 0) + 1;
    }
    if (days.size < 2) return null;
    const hs = Object.keys(byHour).map(Number);
    if (!hs.length) return null;
    const max = Math.max(...hs.map((h) => byHour[h]));
    const hot = hs.filter((h) => byHour[h] >= max * 0.7).sort((a, b) => a - b);
    if (!hot.length) return null;
    return { from: hot[0], to: hot[hot.length - 1], perDay: Math.round((hot.reduce((s, h) => s + byHour[h], 0) / days.size) * 10) / 10, days: days.size };
  })();

  const byType: Record<string, number> = {};
  for (const o of kept) byType[o.order_type] = (byType[o.order_type] || 0) + 1;
  const TYPE_META: [string, string, any][] = [["dine_in", "Dine-in", UtensilsCrossed], ["pickup", "Pickup", ShoppingBag], ["delivery", "Delivery", Bike]];

  const itemCounts: Record<string, number> = {};
  for (const o of kept) for (const i of o.items || []) itemCounts[i.name] = (itemCounts[i.name] || 0) + Number(i.qty || 1);
  const topItems = Object.entries(itemCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const feed = [...(orders || [])].filter((o: any) => new Date(o.created_at).getTime() >= startMs)
    .sort((a: any, b: any) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 6);
  const ago = (t: string) => { const m = Math.round((now - new Date(t).getTime()) / 60000); return m < 1 ? "now" : m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ${m % 60}m ago`; };

  const rangeWord = range === 1 ? "today" : `in the last ${range} days`;
  const pace = delta == null ? null : delta >= 15 ? "busier than usual" : delta <= -15 ? "quieter than usual" : "running about usual";
  const headline = `${range === 1 ? weekday : `Last ${range} days`}${pace ? `, ${pace}` : ""} — ${kept.length} order${kept.length === 1 ? "" : "s"}, EGP ${money(revenue)}. ${urgent.length === 0 ? "Nothing needs you right now." : `${urgent.length} thing${urgent.length > 1 ? "s" : ""} need${urgent.length > 1 ? "" : "s"} you.`}`;

  return (
    <>
      {/* Answer first: the whole screen in one sentence, before any tile. */}
      <p className="mb-4 text-lg leading-snug font-medium text-zinc-100">{headline}</p>

      <AlertStrip urgent={urgent} chores={chores} />

      {/* Hero + supporting metrics: revenue dominates, everything else is context for it. */}
      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Revenue {rangeWord}</div>
          <div className="mt-1 text-4xl font-bold tabular-nums" style={{ color: "var(--accent)" }}>EGP {money(revenue)}</div>
          {delta !== null ? (
            <div className={`mt-1 flex items-center gap-1 text-xs ${delta >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {delta >= 0 ? <TrendingUp size={13} aria-hidden="true" /> : <TrendingDown size={13} aria-hidden="true" />}
              <span>{delta >= 0 ? "up" : "down"} {Math.abs(delta)}% {baselineLabel}</span>
            </div>
          ) : (
            <div className="mt-1 text-xs text-zinc-500">{tooFew}</div>
          )}
          <Spark series={series} />
        </Card>

        <Card className="p-5 lg:col-span-2">
          <div className="mb-3 text-xs uppercase tracking-wide text-zinc-500">Against your usual</div>
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Bullet label="Orders" value={kept.length} display={String(kept.length)} target={enough ? prev.length : null} />
            <Bullet label="Avg ticket" value={avgTicket} display={`EGP ${money(avgTicket)}`} target={enough ? prevAvgTicket : null} />
            <Bullet label="Open on the board" value={openNow} display={String(openNow)}
              note={lateNow > 0 ? `${lateNow} late` : "none late"} tone={lateNow > 0 ? "bad" : "good"} />
            <Bullet label="Taken by the AI" value={aiPct ?? 0} display={aiPct == null ? "—" : `${aiPct}%`} max={100}
              note={aiPct == null ? "no orders yet" : `${aiCount} of ${kept.length}`} />
          </div>
        </Card>
      </div>

      {/* Prime cost — food half is provable, labour half needs a wage figure we don't hold. */}
      <Card className="mb-4 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-sm font-semibold text-zinc-200">Prime cost</div>
          <Link to="/menu" className="text-xs text-[var(--accent)] hover:underline">manage costs →</Link>
        </div>
        {foodCostPct == null ? (
          <p className="mt-1 text-xs text-zinc-500">
            No item costs recorded yet, so food cost can't be calculated. Add “Cost to make” on your menu items and this fills in — nothing here is ever estimated.
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap items-end gap-6">
            <div>
              <div className="text-3xl font-bold tabular-nums text-zinc-100">{foodCostPct}%</div>
              <div className="mt-0.5 text-xs text-zinc-500">Food cost {rangeWord}</div>
            </div>
            <div>
              <div className="text-3xl font-bold tabular-nums text-zinc-100">EGP {money(Math.round(costedRev - foodCost))}</div>
              <div className="mt-0.5 text-xs text-zinc-500">Gross profit on costed items</div>
            </div>
            <p className="max-w-md text-xs text-zinc-500">
              {coverage < 100 && <>Covers {coverage}% of revenue — items without a cost are left out. </>}
              Labour isn't recorded anywhere yet, so this is the food half of prime cost, not the whole number.
            </p>
          </div>
        )}
      </Card>

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <h2 className="mb-1 text-sm font-semibold text-zinc-200">{range === 1 ? "Revenue by hour" : "Revenue by day"}</h2>
          {peak && range === 1 && (
            <p className="mb-3 flex items-center gap-1.5 text-xs text-zinc-500">
              <Clock size={12} aria-hidden="true" />
              {weekday}s peak {String(peak.from).padStart(2, "0")}:00–{String(peak.to + 1).padStart(2, "0")}:00 (≈{peak.perDay} orders, {peak.days} {weekday}s) — staff for it.
            </p>
          )}
          <Series series={series} />
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-zinc-200">Where orders come from</h2>
            {kept.length === 0 ? (
              <p className="text-xs text-zinc-500">No orders yet {rangeWord}.</p>
            ) : (
              <div className="space-y-2.5">
                {TYPE_META.map(([k, label, Icon]) => {
                  const n = byType[k] || 0;
                  const pct = kept.length ? Math.round((n / kept.length) * 100) : 0;
                  return (
                    <div key={k}>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5 text-zinc-300"><Icon size={13} aria-hidden="true" /> {label}</span>
                        <span className="tabular-nums text-zinc-400">{n} · {pct}%</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                        <div className="h-full rounded-full bg-zinc-400" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-zinc-200">Top items</h2>
            {topItems.length === 0 ? (
              <p className="text-xs text-zinc-500">Nothing sold {rangeWord}.</p>
            ) : (
              <div className="space-y-2">
                {topItems.map(([name, units], i) => (
                  <div key={name} className="flex items-center justify-between text-sm">
                    <span className="truncate pr-2 text-zinc-300">{i + 1}. {name}</span>
                    <span className="shrink-0 tabular-nums text-zinc-500">×{units}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {(O.by_branch || []).length > 1 && (
        <Card className="mb-4 p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-200"><Store size={14} aria-hidden="true" /> By branch (today)</h2>
          <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            {(O.by_branch || []).map((b: any) => (
              <div key={b.branch} className="flex items-center justify-between rounded-xl bg-zinc-900 px-3 py-2 text-sm">
                <span className="text-zinc-300">{b.branch}</span>
                <span className="tabular-nums text-zinc-400">{b.count} · EGP {money(b.egp)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="mb-4 p-5">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-200"><Activity size={14} aria-hidden="true" /> Live feed</h2>
        {feed.length === 0 ? <p className="text-xs text-zinc-500">Quiet for now — the next ticket lands here.</p> : (
          <div className="space-y-1.5">
            {feed.map((o: any) => (
              <div key={o.id} className="flex items-center justify-between rounded-xl bg-zinc-900 px-3 py-2 text-sm">
                <span className="flex items-center gap-2">
                  <span className="font-mono font-bold text-zinc-300">{o.code}</span>
                  <span className="text-xs text-zinc-500">{(o.items || []).reduce((s: number, i: any) => s + Number(i.qty || 1), 0)} items · {String(o.order_type).replace("_", "-")}{o.branch ? ` · ${o.branch}` : ""}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums text-xs text-zinc-400">EGP {money(o.total || 0)}</span>
                  <Pill value={o.status} />
                  <span className="w-16 text-right text-xs tabular-nums text-zinc-500">{ago(o.created_at)}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <ForecastAndCrew orders={orders} />

      <Card className="mt-4 border-emerald-500/30 p-5">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-emerald-300"><Bot size={15} aria-hidden="true" /> AI order agent — {rangeWord}</h2>
        <p className="text-sm text-zinc-400">
          The AI took <b className="text-zinc-200">{aiCount}</b> of <b className="text-zinc-200">{kept.length}</b> orders
          {revenue ? <> worth <b className="text-zinc-200">EGP {money(revenue)}</b></> : null} — menu questions, options, bills, receipts and status updates included, with staff stepping in only where the strip above says so.
        </p>
      </Card>
    </>
  );
}

// Value against its own usual. The marker and the word carry the meaning; colour only
// reinforces it, so this still reads in greyscale.
function Bullet({ label, value, display, target, max, note, tone }:
  { label: string; value: number; display: string; target?: number | null; max?: number; note?: string; tone?: "good" | "bad" }) {
  const ceiling = max ?? ((Math.max(value, target || 0) * 1.25) || 1);
  const pct = Math.min(100, (value / ceiling) * 100);
  const tPct = target != null && target > 0 ? Math.min(100, (target / ceiling) * 100) : null;
  const verdict = target != null && target > 0
    ? (value >= target * 1.05 ? "above usual" : value <= target * 0.95 ? "below usual" : "about usual")
    : note || null;
  const vTone = tone || (target != null && target > 0
    ? (value >= target * 1.05 ? "good" : value <= target * 0.95 ? "bad" : undefined)
    : undefined);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-zinc-400">{label}</span>
        <span className="text-sm font-semibold tabular-nums text-zinc-100">{display}</span>
      </div>
      <div className="relative mt-1.5 h-2 overflow-visible rounded-full bg-zinc-800">
        <div className="h-full rounded-full bg-zinc-400" style={{ width: `${pct}%` }} />
        {tPct != null && (
          <div className="absolute -top-0.5 h-3 w-0.5 bg-zinc-100" style={{ left: `${tPct}%` }} aria-hidden="true" />
        )}
      </div>
      {verdict && (
        <div className={`mt-1 text-xs ${vTone === "good" ? "text-emerald-400" : vTone === "bad" ? "text-amber-400" : "text-zinc-500"}`}>
          {verdict}{target != null && target > 0 ? ` · usual ${money(target)}` : ""}
        </div>
      )}
    </div>
  );
}

// A trend needs at least four points to be a trend. Below that a chart invents a shape
// that isn't there — a single full-width bar reads as an enormous value.
function Series({ series }: { series: { label: string; value: number; count: number; isNow?: boolean }[] }) {
  const withData = series.filter((s) => s.count > 0);
  if (withData.length === 0) return <p className="text-xs text-zinc-500">No orders in this window yet.</p>;
  if (withData.length < 4)
    return (
      <div className="flex flex-wrap gap-6 py-2">
        {withData.map((s) => (
          <div key={s.label}>
            <div className="text-2xl font-bold tabular-nums text-zinc-100">EGP {money(s.value)}</div>
            <div className="mt-0.5 text-xs text-zinc-500">{s.label} · {s.count} order{s.count === 1 ? "" : "s"}</div>
          </div>
        ))}
        <p className="self-end text-xs text-zinc-600">Too few points to plot — shown as figures instead.</p>
      </div>
    );
  const top = Math.max(...series.map((s) => s.value), 1);
  return (
    <>
      <div className="flex h-36 items-end gap-1.5">
        {series.map((s) => (
          <div key={s.label} className="flex h-full flex-1 flex-col items-center justify-end gap-1"
            title={`${s.label} · EGP ${money(s.value)} · ${s.count} order${s.count === 1 ? "" : "s"}`}>
            <div className={`w-full rounded-t-md ${s.isNow ? "" : "bg-zinc-400"}`}
              style={{ height: `${Math.max(2, (s.value / top) * 100)}%`, ...(s.isNow ? { backgroundColor: "var(--accent)" } : {}) }} />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        {series.map((s) => (
          <div key={s.label} className="flex-1 text-center text-xs text-zinc-500">{s.label}</div>
        ))}
      </div>
    </>
  );
}

function Spark({ series }: { series: { value: number }[] }) {
  const pts = series.filter((_, i) => i < 60);
  if (pts.length < 4) return null;
  const top = Math.max(...pts.map((p) => p.value), 1);
  return (
    <div className="mt-3 flex h-8 items-end gap-0.5" aria-hidden="true">
      {pts.map((p, i) => (
        <div key={i} className="flex-1 rounded-t-sm bg-zinc-700" style={{ height: `${Math.max(4, (p.value / top) * 100)}%` }} />
      ))}
    </div>
  );
}

// ---------------- fine dining: the original reservation-first board ----------------

function FineBoard({ kpis, agent }: any) {
  const stats = [
    { label: "Covers today", value: kpis.covers_today },
    { label: "Reservations today", value: kpis.reservations_today },
    { label: "Tables seated", value: `${kpis.tables_seated}/${kpis.tables_total}` },
    { label: "Waitlist now", value: kpis.waitlist_now },
    { label: "Open orders", value: kpis.open_orders },
    { label: "Pending deposits", value: kpis.pending_deposits },
    { label: "No-show rate", value: `${kpis.no_show_rate_pct}%` },
    { label: "Avg rating", value: kpis.avg_rating ?? "—" },
  ];
  return (
    <>
      {agent && (
        <Card className="mb-5 border-emerald-500/30 p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-emerald-300"><Bot size={15} aria-hidden="true" /> Reservation agent — last {agent.days} days</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
            {[
              { label: "AI bookings", value: agent.ai_bookings },
              { label: "AI covers", value: agent.ai_covers },
              { label: "Arrivals handled", value: agent.arrivals_handled },
              { label: "Abandoned leads", value: agent.abandoned_leads },
              { label: "Walk-ins / manual", value: `${agent.walk_ins} / ${agent.manual_bookings}` },
            ].map((s) => (
              <div key={s.label}>
                <div className="text-2xl font-bold tabular-nums">{s.value}</div>
                <div className="mt-0.5 text-xs uppercase tracking-wide text-zinc-500">{s.label}</div>
              </div>
            ))}
          </div>
        </Card>
      )}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="p-5">
            <div className="text-3xl font-bold tabular-nums">{s.value}</div>
            <div className="mt-1 text-xs uppercase tracking-wide text-zinc-500">{s.label}</div>
          </Card>
        ))}
      </div>
    </>
  );
}

function FineBottom({ kpis }: any) {
  const maxCovers = Math.max(1, ...kpis.by_slot.map((s: any) => s.covers));
  return (
    <div className="mt-6 grid gap-4 lg:grid-cols-2">
      <Card className="p-5">
        <h2 className="mb-4 text-sm font-semibold text-zinc-200">Covers by slot (today)</h2>
        {kpis.by_slot.length === 0 ? (
          <p className="text-xs text-zinc-500">No reservations today yet.</p>
        ) : (
          <div className="flex h-40 items-end gap-2">
            {kpis.by_slot.map((s: any) => (
              <div key={s.slot} className="flex flex-1 flex-col items-center gap-1">
                <div className="text-xs text-zinc-400">{s.covers}</div>
                <div className="w-full rounded-t-lg bg-amber-500/80" style={{ height: `${(s.covers / maxCovers) * 100}%` }} />
                <div className="text-xs text-zinc-500">{s.slot}</div>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card className="p-5">
        <h2 className="mb-4 text-sm font-semibold text-zinc-200">Next up</h2>
        {kpis.upcoming.length === 0 ? (
          <p className="text-xs text-zinc-500">Nothing upcoming.</p>
        ) : (
          <div className="space-y-2">
            {kpis.upcoming.map((r: any) => (
              <div key={r.id} className="flex items-center justify-between rounded-xl bg-zinc-900 px-3 py-2.5">
                <div>
                  <div className="text-sm font-medium">{r.diner_name || r.diner_phone} · {r.party_size}p</div>
                  <div className="text-xs text-zinc-500">{r.date} {String(r.time_slot).slice(0, 5)}{r.occasion ? ` · ${r.occasion}` : ""}</div>
                </div>
                <Pill value={r.status} />
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function GuestsCard({ guests }: { guests: any[] }) {
  if (!guests.length) return null;
  const week = Date.now() - 7 * 86400000;
  const newThisWeek = guests.filter((g) => new Date(g.created_at).getTime() > week).length;
  const visited = guests.filter((g) => Number(g.visit_count) > 0);
  const repeat = visited.length ? Math.round((visited.filter((g) => Number(g.visit_count) >= 2).length / visited.length) * 100) : 0;
  const top = [...guests].sort((a, b) => Number(b.total_spend || 0) - Number(a.total_spend || 0)).slice(0, 5).filter((g) => Number(g.total_spend) > 0);
  return (
    <Card className="mt-6 p-5">
      <h2 className="mb-3 text-sm font-semibold text-zinc-200">Guests</h2>
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <div className="text-3xl font-bold tabular-nums">{newThisWeek}</div>
          <div className="mt-1 text-xs uppercase tracking-wide text-zinc-500">New this week</div>
        </div>
        <div>
          <div className="text-3xl font-bold tabular-nums">{repeat}%</div>
          <div className="mt-1 text-xs uppercase tracking-wide text-zinc-500">
            Repeat rate{visited.length < 10 ? <span className="ml-1 normal-case tracking-normal text-zinc-600">({visited.length} guests — early)</span> : null}
          </div>
        </div>
        <div>
          <div className="mb-1 text-xs uppercase tracking-wide text-zinc-500">Top spenders</div>
          {top.length === 0 ? <div className="text-xs text-zinc-600">—</div> : top.map((g) => (
            <div key={g.id} className="flex justify-between text-xs">
              <span className="truncate pr-2 text-zinc-300">{g.name || g.wa_profile_name || g.phone_number}</span>
              <span className="tabular-nums text-zinc-400">EGP {Number(g.total_spend).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

// Tomorrow's expected load, from the same weekday over the last 4 weeks. One weekday on
// record is not a forecast — below two, this says so instead of printing "expect ≈0".
function ForecastAndCrew({ orders }: { orders: any[] }) {
  const tomorrow = new Date(Date.now() + 86400000);
  const wdName = tomorrow.toLocaleDateString("en-GB", { weekday: "long" });
  const wd = tomorrow.getDay();
  const cutoff = Date.now() - 28 * 86400000;
  const sameDay = orders.filter((o) => {
    const d = new Date(o.created_at);
    return d.getDay() === wd && d.getTime() > cutoff && o.status !== "cancelled";
  });
  const daysSeen = new Set(sameDay.map((o) => dayOf(o.created_at))).size;
  const canForecast = daysSeen >= 2;
  const byHour: Record<number, number> = {};
  for (const o of sameDay) byHour[new Date(o.created_at).getHours()] = (byHour[new Date(o.created_at).getHours()] || 0) + 1;
  const hours = Object.keys(byHour).map(Number).sort((a, b) => a - b);
  const maxH = Math.max(1, ...hours.map((h) => byHour[h] / Math.max(1, daysSeen)));
  const expTotal = daysSeen ? Math.round(sameDay.length / daysSeen) : 0;

  const week = Date.now() - 7 * 86400000;
  const crew: Record<string, { orders: number; egp: number }> = {};
  for (const o of orders) {
    if (!o.cashier || new Date(o.created_at).getTime() < week || o.status === "cancelled") continue;
    crew[o.cashier] = crew[o.cashier] || { orders: 0, egp: 0 };
    crew[o.cashier].orders += 1;
    crew[o.cashier].egp += Number(o.total) || 0;
  }
  const crewNames = Object.keys(crew).sort((a, b) => crew[b].orders - crew[a].orders);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="p-5 lg:col-span-2">
        <h2 className="mb-1 text-sm font-semibold text-zinc-200">Tomorrow's forecast — {wdName}</h2>
        {canForecast && hours.length > 0 ? (
          <>
            <p className="mb-3 text-xs text-zinc-500">Average of the last {daysSeen} {wdName}s — expect ≈{expTotal} orders. Prep and staff for it.</p>
            <div className="flex h-24 items-end gap-1">
              {hours.map((h) => (
                <div key={h} className="flex flex-1 flex-col items-center gap-0.5"
                  title={`${String(h).padStart(2, "0")}:00 · ≈${Math.round((byHour[h] / daysSeen) * 10) / 10} orders`}>
                  <div className="w-full rounded-t bg-zinc-500" style={{ height: `${(byHour[h] / daysSeen / maxH) * 100}%` }} />
                  <div className="text-xs text-zinc-500">{String(h).padStart(2, "0")}</div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="text-xs text-zinc-500">
            {daysSeen === 1
              ? `Only one ${wdName} on record — not enough to forecast from yet.`
              : `No ${wdName}s on record yet — check back after a week of orders.`}
          </p>
        )}
      </Card>
      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold text-zinc-200">Crew — last 7 days</h2>
        {crewNames.length === 0 ? <p className="text-xs text-zinc-500">No cashier-attributed orders yet.</p> : (
          <div className="space-y-1.5">
            {crewNames.map((c) => (
              <div key={c} className="flex items-center justify-between text-xs">
                <span className="truncate pr-2 text-zinc-300">{c}</span>
                <span className="shrink-0 tabular-nums text-zinc-500">{crew[c].orders} orders · EGP {money(Math.round(crew[c].egp))}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
