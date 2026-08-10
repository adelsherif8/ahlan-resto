import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, Bot, Store, TrendingUp, TrendingDown, CheckCircle2, Flame, UtensilsCrossed, Bike, ShoppingBag, Activity } from "lucide-react";
import { api } from "../config/api";
import { Card, PageHeader, Pill, Empty } from "../components/ui";

import { money } from "../lib/format";

export default function Overview() {
  const [kpis, setKpis] = useState<any | null>(null);
  const [agent, setAgent] = useState<any | null>(null);
  const [guests, setGuests] = useState<any[]>([]);
  const [rtype, setRtype] = useState<string>("fine");
  const [sampleCount, setSampleCount] = useState(0);
  const [orders, setOrders] = useState<any[]>([]);
  const [menuItems, setMenuItems] = useState<any[]>([]);

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
    const load = () => {
      api.get("/api/dashboard/kpis").then((r) => setKpis(r.data)).catch(() => {});
      api.get("/api/orders").then((r) => setOrders(r.data || [])).catch(() => {});
    };
    load();
    api.get("/api/dashboard/agent-stats").then((r) => setAgent(r.data)).catch(() => {});
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  if (!kpis) return <Empty text="Loading…" />;
  const casual = rtype === "casual";
  const O = kpis.orders_today || {};

  // one strip for everything that needs a human, instead of scattered banners —
  // each row is a door to the page that fixes it, red when guests are waiting
  const needs: { text: string; to: string; hot?: boolean }[] = [];
  if (O.late_now > 0) needs.push({ text: `${O.late_now} order${O.late_now > 1 ? "s" : ""} running late on the board`, to: "/orders", hot: true });
  if (kpis.needs_attention > 0) needs.push({ text: `${kpis.needs_attention} conversation${kpis.needs_attention > 1 ? "s" : ""} need${kpis.needs_attention > 1 ? "" : "s"} a human`, to: "/chats" });
  if (sampleCount > 0) needs.push({ text: `${sampleCount} menu item${sampleCount > 1 ? "s" : ""} still ha${sampleCount > 1 ? "ve" : "s"} unverified prices`, to: "/menu" });
  // stock pace: tracked items projected to run out before close, at today's rate
  const today = new Date().toLocaleDateString("en-CA");
  const todaysOrders = orders.filter((o) => String(o.created_at).slice(0, 10) === today && o.status !== "cancelled");
  const soldToday: Record<string, number> = {};
  for (const o of todaysOrders) for (const i of o.items || []) soldToday[i.name] = (soldToday[i.name] || 0) + Number(i.qty || 1);
  const firstAt = todaysOrders.length ? new Date(todaysOrders[0].created_at).getTime() : 0;
  const hoursSoFar = firstAt ? Math.max(0.5, (Date.now() - firstAt) / 3600000) : 0;
  for (const m of menuItems) {
    if (m.stock_count == null || m.stock_count <= 0 || !hoursSoFar) continue;
    const rate = (soldToday[m.name] || 0) / hoursSoFar;
    if (rate <= 0) continue;
    const runout = new Date(Date.now() + (m.stock_count / rate) * 3600000);
    if (runout.getDate() === new Date().getDate()) {
      needs.push({ text: `${m.name}: ${m.stock_count} left — runs out ~${runout.getHours()}:${String(runout.getMinutes()).padStart(2, "0")} at this pace`, to: "/menu" });
    }
  }
  // margin leaks: heavy discounting or a cancellation spike reads as money walking out
  const discToday = todaysOrders.reduce((s2, o) => s2 + (Number(o.discount) || 0), 0);
  const revToday = todaysOrders.reduce((s2, o) => s2 + (Number(o.total) || 0), 0);
  if (revToday > 0 && discToday / revToday > 0.1) needs.push({ text: `Discounts are ${Math.round((discToday / revToday) * 100)}% of today's revenue (EGP ${money(discToday)}) — check the Z report`, to: "/pos" });
  const cancToday = orders.filter((o) => String(o.created_at).slice(0, 10) === today && o.status === "cancelled");
  if (cancToday.length >= 3) needs.push({ text: `${cancToday.length} cancellations today (EGP ${money(cancToday.reduce((s2, o) => s2 + (Number(o.total) || 0), 0))}) — look for a pattern`, to: "/orders", hot: true });

  return (
    <div>
      <PageHeader title="Overview" subtitle={casual ? "Today at a glance" : "Tonight at a glance"} />

      <div className="mb-5 space-y-1.5">
        {needs.length === 0 ? (
          <div className="flex items-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-2.5 text-sm text-zinc-300">
            <CheckCircle2 size={15} className="shrink-0 text-emerald-400" /> All clear — no late orders, no stuck chats, nothing waiting on you.
          </div>
        ) : needs.map((n, i) => (
          <Link key={i} to={n.to}
            className={`flex items-center gap-2 rounded-2xl border px-4 py-2.5 text-sm text-zinc-100 transition hover:brightness-125 ${n.hot ? "border-red-500/50 bg-red-500/10" : "border-amber-500/40 bg-amber-500/10"}`}>
            <AlertCircle size={15} className={`shrink-0 ${n.hot ? "text-red-400" : "text-amber-400"}`} />
            <span className="flex-1">{n.text}</span>
            <span className="text-xs text-zinc-500">open</span>
          </Link>
        ))}
      </div>

      {casual ? <CasualBoard O={O} kpis={kpis} orders={orders} /> : <FineBoard kpis={kpis} agent={agent} />}

      <GuestsCard guests={guests} />

      {!casual && <FineBottom kpis={kpis} />}
    </div>
  );
}

// ---------------- casual: orders-first ----------------

function CasualBoard({ O, kpis, orders }: any) {
  const aiPct = O.count > 0 ? Math.round(((O.ai_count || 0) / O.count) * 100) : null;
  const today = new Date().toLocaleDateString("en-CA");
  const todays = (orders || []).filter((o: any) => String(o.created_at).slice(0, 10) === today && o.status !== "cancelled");
  // Same-weekday comparison: a Friday only means something next to last Friday, not
  // Thursday. Falls back to vs-yesterday when last week has no data (young restaurants).
  const lastWeekISO = new Date(Date.now() - 7 * 86400000).toLocaleDateString("en-CA");
  const lastWeekRev = (orders || [])
    .filter((o: any) => String(o.created_at).slice(0, 10) === lastWeekISO && o.status !== "cancelled")
    .reduce((s: number, o: any) => s + (Number(o.total) || 0), 0);
  const weekday = new Date().toLocaleDateString("en", { weekday: "long" });
  const delta = lastWeekRev > 0 ? Math.round((((O.revenue || 0) - lastWeekRev) / lastWeekRev) * 100)
    : O.revenue_yesterday > 0 ? Math.round((((O.revenue || 0) - O.revenue_yesterday) / O.revenue_yesterday) * 100) : null;
  const deltaLabel = lastWeekRev > 0 ? `vs last ${weekday}` : "vs yesterday";
  // "Usual pace" per hour: the average of the last 4 same-weekday days, so tonight's
  // curve reads as busy/slow FOR THIS WEEKDAY — not vs an arbitrary flat scale.
  const usualByHour: Record<number, number> = {};
  {
    const sameDays: string[] = [];
    for (let w = 1; w <= 4; w++) sameDays.push(new Date(Date.now() - w * 7 * 86400000).toLocaleDateString("en-CA"));
    const counts: Record<number, number> = {};
    let daysWithData = 0;
    for (const d of sameDays) {
      const dayOrders = (orders || []).filter((o: any) => String(o.created_at).slice(0, 10) === d && o.status !== "cancelled");
      if (!dayOrders.length) continue;
      daysWithData++;
      for (const o of dayOrders) { const h = new Date(o.created_at).getHours(); counts[h] = (counts[h] || 0) + 1; }
    }
    if (daysWithData) for (const h of Object.keys(counts)) usualByHour[Number(h)] = counts[Number(h)] / daysWithData;
  }
  // Top movers: items selling clearly above/below their own recent norm (last 7 days'
  // daily rate vs the 21 days before). Only items with enough history to mean anything.
  const movers: { name: string; pct: number }[] = [];
  {
    const now = Date.now();
    const rate = (from: number, to: number) => {
      const per: Record<string, number> = {};
      for (const o of orders || []) {
        const t = new Date(o.created_at).getTime();
        if (t < from || t >= to || o.status === "cancelled") continue;
        for (const i of o.items || []) per[i.name] = (per[i.name] || 0) + Number(i.qty || 1);
      }
      return per;
    };
    const recent = rate(now - 7 * 86400000, now);            // units in last 7 days
    const base = rate(now - 28 * 86400000, now - 7 * 86400000); // units in the 21 days before
    for (const name of new Set([...Object.keys(recent), ...Object.keys(base)])) {
      const r = (recent[name] || 0) / 7, b = (base[name] || 0) / 21;
      if (b * 21 < 3 && (recent[name] || 0) < 3) continue; // too little history to call a trend
      const pct = b > 0 ? Math.round(((r - b) / b) * 100) : 100;
      if (Math.abs(pct) >= 40) movers.push({ name, pct });
    }
    movers.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  }
  const byType: Record<string, number> = {};
  for (const o of todays) byType[o.order_type] = (byType[o.order_type] || 0) + 1;
  const avgTicket = O.count > 0 ? Math.round((O.revenue || 0) / O.count) : null;
  const stats = [
    { label: "Revenue today", value: `EGP ${money(O.revenue || 0)}`, sub: delta !== null ? `${delta >= 0 ? "+" : ""}${delta}% ${deltaLabel}` : null, up: delta !== null ? delta >= 0 : null },
    { label: "Orders today", value: O.count ?? 0, sub: O.cancelled ? `${O.cancelled} cancelled` : null },
    { label: "Avg ticket", value: avgTicket != null ? `EGP ${money(avgTicket)}` : "—" },
    { label: "Open now", value: O.open_now ?? 0, sub: O.late_now ? `${O.late_now} late` : null },
    { label: "Avg prep", value: O.avg_prep != null ? `${O.avg_prep} min` : "—" },
    { label: "AI-taken", value: aiPct != null ? `${aiPct}%` : "—", sub: O.ai_count != null ? `${O.ai_count} of ${O.count}` : null },
  ];
  const TYPE_META: [string, string, any][] = [["dine_in", "Dine-in", UtensilsCrossed], ["pickup", "Pickup", ShoppingBag], ["delivery", "Delivery", Bike]];
  const feed = [...todays].sort((a: any, b: any) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 6);
  const ago = (t: string) => { const m = Math.round((Date.now() - new Date(t).getTime()) / 60000); return m < 1 ? "now" : m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ${m % 60}m ago`; };
  const maxHour = Math.max(1, ...(O.by_hour || []).map((h: any) => h.count));
  return (
    <>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        {stats.map((s) => (
          <Card key={s.label} className="p-4">
            <div className="text-2xl font-bold tabular-nums">{s.value}</div>
            <div className="mt-1 text-[11px] uppercase tracking-wide text-zinc-500">{s.label}</div>
            {s.sub && (
              <div className={`mt-0.5 flex items-center gap-1 text-[11px] ${s.up === true ? "text-emerald-400" : s.up === false ? "text-red-400" : "text-zinc-500"}`}>
                {s.up === true && <TrendingUp size={11} />}
                {s.up === false && <TrendingDown size={11} />}
                {s.sub}
              </div>
            )}
          </Card>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <h2 className="mb-1 text-sm font-semibold text-zinc-300">Orders by hour (today)</h2>
          {Object.keys(usualByHour).length > 0 && (
            <div className="mb-3 text-[11px] text-zinc-500">— dash = your usual {weekday} at that hour (4-week average)</div>
          )}
          {(O.by_hour || []).length === 0 ? (
            <Empty text="No orders yet today" />
          ) : (
            <div className="flex h-36 items-end gap-1.5">
              {(O.by_hour || []).map((h: any) => {
                const usual = usualByHour[h.hour];
                const scale = Math.max(maxHour, ...Object.values(usualByHour));
                return (
                  <div key={h.hour} className="flex h-full flex-1 flex-col items-center gap-1">
                    <div className="text-xs text-zinc-400">{h.count}</div>
                    <div className="relative w-full flex-1">
                      <div className="absolute bottom-0 w-full rounded-t-md" style={{ height: `${(h.count / scale) * 100}%`, backgroundColor: "var(--accent)", opacity: 0.85 }} />
                      {usual != null && (
                        <div className="absolute w-full border-t-2 border-dashed border-zinc-400/70" style={{ bottom: `${(usual / scale) * 100}%` }} title={`usual: ${usual.toFixed(1)}`} />
                      )}
                    </div>
                    <div className="text-[10px] text-zinc-500">{String(h.hour).padStart(2, "0")}</div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-zinc-300">Top items today</h2>
            {(O.top_items || []).length === 0 ? (
              <Empty text="—" />
            ) : (
              <div className="space-y-2">
                {(O.top_items || []).map((t: any, i: number) => (
                  <div key={t.name} className="flex items-center justify-between text-sm">
                    <span className="truncate pr-2 text-zinc-300">{i + 1}. {t.name}</span>
                    <span className="shrink-0 tabular-nums text-zinc-500">×{t.units}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
          {movers.length > 0 && (
            <Card className="p-5">
              <h2 className="mb-1 text-sm font-semibold text-zinc-300">Movers vs usual</h2>
              <div className="mb-3 text-[11px] text-zinc-500">selling clearly above/below their own 4-week norm</div>
              <div className="space-y-2">
                {movers.slice(0, 4).map((m) => (
                  <div key={m.name} className="flex items-center justify-between text-sm">
                    <span className="truncate pr-2 text-zinc-300">{m.name}</span>
                    <span className={`flex shrink-0 items-center gap-1 tabular-nums ${m.pct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {m.pct >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}{m.pct >= 0 ? "+" : ""}{m.pct}%
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>

      {(O.by_branch || []).length > 1 && (
        <Card className="mt-4 p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-300"><Store size={14} /> By branch (today)</h2>
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

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-zinc-300">Where orders come from</h2>
          <div className="space-y-2.5">
            {TYPE_META.map(([k, label, Icon]) => {
              const n = byType[k] || 0;
              const pct = todays.length ? Math.round((n / todays.length) * 100) : 0;
              return (
                <div key={k}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-zinc-300"><Icon size={12} /> {label}</span>
                    <span className="tabular-nums text-zinc-500">{n} · {pct}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: "var(--accent)" }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
        <Card className="p-5 lg:col-span-2">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-300"><Activity size={14} /> Live feed</h2>
          {feed.length === 0 ? <Empty text="Quiet for now — the next ticket lands here" /> : (
            <div className="space-y-1.5">
              {feed.map((o: any) => (
                <div key={o.id} className="flex items-center justify-between rounded-xl bg-zinc-900 px-3 py-2 text-sm">
                  <span className="flex items-center gap-2">
                    <span className="font-mono font-bold text-zinc-300">{o.code}</span>
                    <span className="text-xs text-zinc-500">{(o.items || []).reduce((s2: number, i2: any) => s2 + Number(i2.qty || 1), 0)} items · {String(o.order_type).replace("_", "-")}{o.branch ? ` · ${o.branch}` : ""}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums text-xs text-zinc-400">EGP {money(o.total || 0)}</span>
                    <Pill value={o.status} />
                    <span className="w-14 text-right text-[10px] tabular-nums text-zinc-600">{ago(o.created_at)}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <ForecastAndCrew orders={orders} />

      <Card className="mt-4 border-emerald-500/30 p-5">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-emerald-300"><Bot size={15} /> AI order agent — today</h2>
        <p className="text-sm text-zinc-400">
          The AI took <b className="text-zinc-200">{O.ai_count ?? 0}</b> of <b className="text-zinc-200">{O.count ?? 0}</b> orders
          {O.revenue ? <> worth <b className="text-zinc-200">EGP {money(O.revenue)}</b></> : null} — menu questions, options, bills, receipts and status updates included, with staff stepping in only where the strip above says so.
        </p>
      </Card>
    </>
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
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-emerald-300"><Bot size={15} /> Reservation agent — last {agent.days} days</h2>
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
                <div className="mt-0.5 text-[11px] uppercase tracking-wide text-zinc-500">{s.label}</div>
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
        <h2 className="mb-4 text-sm font-semibold text-zinc-300">Covers by slot (today)</h2>
        {kpis.by_slot.length === 0 ? (
          <Empty text="No reservations today yet" />
        ) : (
          <div className="flex h-40 items-end gap-2">
            {kpis.by_slot.map((s: any) => (
              <div key={s.slot} className="flex flex-1 flex-col items-center gap-1">
                <div className="text-xs text-zinc-400">{s.covers}</div>
                <div className="w-full rounded-t-lg bg-amber-500/80" style={{ height: `${(s.covers / maxCovers) * 100}%` }} />
                <div className="text-[10px] text-zinc-500">{s.slot}</div>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card className="p-5">
        <h2 className="mb-4 text-sm font-semibold text-zinc-300">Next up</h2>
        {kpis.upcoming.length === 0 ? (
          <Empty text="Nothing upcoming" />
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
      <h2 className="mb-3 text-sm font-semibold text-zinc-300">Guests</h2>
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <div className="text-3xl font-bold tabular-nums">{newThisWeek}</div>
          <div className="mt-1 text-xs uppercase tracking-wide text-zinc-500">New this week</div>
        </div>
        <div>
          <div className="text-3xl font-bold tabular-nums">{repeat}%</div>
          <div className="mt-1 text-xs uppercase tracking-wide text-zinc-500">Repeat rate</div>
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

// Tomorrow's expected load (average of the same weekday, last 4 weeks — pure
// code, zero LLM) + who rang what this week once cashier attribution has data.
function ForecastAndCrew({ orders }: { orders: any[] }) {
  const tomorrow = new Date(Date.now() + 86400000);
  const wd = tomorrow.getDay();
  const cutoff = Date.now() - 28 * 86400000;
  const sameDay = orders.filter((o) => {
    const d = new Date(o.created_at);
    return d.getDay() === wd && d.getTime() > cutoff && o.status !== "cancelled";
  });
  const daysSeen = new Set(sameDay.map((o) => String(o.created_at).slice(0, 10))).size || 1;
  const byHour: Record<number, number> = {};
  for (const o of sameDay) byHour[new Date(o.created_at).getHours()] = (byHour[new Date(o.created_at).getHours()] || 0) + 1;
  const hours = Object.keys(byHour).map(Number).sort((a, b) => a - b);
  const maxH = Math.max(1, ...hours.map((h) => byHour[h] / daysSeen));
  const expTotal = Math.round(sameDay.length / daysSeen);

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
    <div className="mt-4 grid gap-4 lg:grid-cols-3">
      <Card className="p-5 lg:col-span-2">
        <h2 className="mb-1 text-sm font-semibold text-zinc-300">Tomorrow's forecast — {tomorrow.toLocaleDateString("en-GB", { weekday: "long" })}</h2>
        <p className="mb-3 text-[11px] text-zinc-500">Average of the last {daysSeen} {tomorrow.toLocaleDateString("en-GB", { weekday: "long" })}{daysSeen > 1 ? "s" : ""} — expect ≈{expTotal} orders. Prep and staff for it.</p>
        {hours.length === 0 ? <Empty text="Not enough history yet — check back after a week of orders" /> : (
          <div className="flex h-24 items-end gap-1">
            {hours.map((h) => (
              <div key={h} className="flex flex-1 flex-col items-center gap-0.5">
                <div className="text-[10px] text-zinc-500">{Math.round((byHour[h] / daysSeen) * 10) / 10}</div>
                <div className="w-full rounded-t" style={{ height: `${(byHour[h] / daysSeen / maxH) * 100}%`, backgroundColor: "var(--accent)", opacity: 0.6 }} />
                <div className="text-[9px] text-zinc-600">{String(h).padStart(2, "0")}</div>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold text-zinc-300">Crew — last 7 days</h2>
        {crewNames.length === 0 ? <Empty text="No cashier-attributed orders yet" /> : (
          <div className="space-y-1.5">
            {crewNames.map((c2) => (
              <div key={c2} className="flex items-center justify-between text-xs">
                <span className="text-zinc-300">{c2}</span>
                <span className="tabular-nums text-zinc-500">{crew[c2].orders} orders · EGP {money(Math.round(crew[c2].egp))}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
