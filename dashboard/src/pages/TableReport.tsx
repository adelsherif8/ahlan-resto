// Table ordering report — the owner's proof that the table chat earns its keep:
// orders and revenue from tables, average check, add-on rate, time to ready, peak hours,
// top items, per-branch split and the table-chat rating. Computed from /api/orders.
import { useMemo, useState } from "react";
import { QrCode, Receipt, TrendingUp, Layers, Timer, Star, Clock, Store } from "lucide-react";
import { api } from "../config/api";
import { Card, PageHeader, Empty } from "../components/ui";
import { usePoll } from "../lib/usePoll";

const DONE = ["completed", "delivered", "served", "closed"];
const money = (n: number) => Math.round(n).toLocaleString();

export default function TableReport() {
  const [days, setDays] = useState(30);
  const [orders, setOrders] = useState<any[] | null>(null);
  const [reviews, setReviews] = useState<any[]>([]);
  const [branchNames, setBranchNames] = useState<Record<string, string>>({});

  usePoll(() => {
    api.get("/api/orders", { params: { branch: "all", since_days: days } }).then((r) => setOrders(Array.isArray(r.data) ? r.data : r.data?.orders || [])).catch(() => setOrders([]));
    api.get("/api/reviews").then((r) => setReviews(r.data?.reviews || [])).catch(() => {});
    api.get("/api/settings").then((r) => {
      const bs = (r.data?.basic_info || r.data?.config?.basic_info || {}).branches || [];
      setBranchNames(Object.fromEntries(bs.filter((b: any) => b?.key).map((b: any) => [b.key, b.name || b.key])));
    }).catch(() => {});
  }, 60000, [days]);

  // table orders = dine-in tickets that came from the table chat (POS tickets carry a cashier)
  const rows = useMemo(() => (orders || []).filter((o) => o.order_type === "dine_in" && o.table_number && !o.cashier && o.status !== "cancelled"), [orders]);
  const m = useMemo(() => {
    const n = rows.length;
    const revenue = rows.reduce((s, o) => s + Number(o.total || 0), 0);
    const lines = rows.map((o) => (o.items || []).reduce((s: number, i: any) => s + Number(i.qty || 1), 0));
    const addOn = rows.filter((o) => (o.items || []).length > 1).length;
    const ready = rows.map((o) => (o.ready_at ? (new Date(o.ready_at).getTime() - new Date(o.created_at).getTime()) / 60000 : null)).filter((x): x is number => x !== null && x > 0 && x < 180);
    const hours = Array.from({ length: 24 }, (_, h) => rows.filter((o) => new Date(o.created_at).getHours() === h).length);
    const items: Record<string, { qty: number; rev: number }> = {};
    for (const o of rows) for (const i of o.items || []) { const k = i.name; items[k] ??= { qty: 0, rev: 0 }; items[k].qty += Number(i.qty || 1); items[k].rev += Number(i.unit_price || i.price || 0) * Number(i.qty || 1); }
    const top = Object.entries(items).sort((a, b) => b[1].qty - a[1].qty).slice(0, 8);
    const byBranch: Record<string, { n: number; rev: number }> = {};
    for (const o of rows) { const b = o.branch || "—"; byBranch[b] ??= { n: 0, rev: 0 }; byBranch[b].n++; byBranch[b].rev += Number(o.total || 0); }
    const tableRatings = reviews.filter((r) => r.source === "table_chat" && r.rating != null);
    return {
      n, revenue, aov: n ? revenue / n : 0, perOrder: n ? lines.reduce((a, b) => a + b, 0) / n : 0, addOnRate: n ? (addOn / n) * 100 : 0,
      ready: ready.length ? ready.reduce((a, b) => a + b, 0) / ready.length : null, served: rows.filter((o) => DONE.includes(o.status)).length,
      hours, peak: Math.max(1, ...hours), top, byBranch,
      rating: tableRatings.length ? tableRatings.reduce((s, r) => s + r.rating, 0) / tableRatings.length : null, ratingN: tableRatings.length,
    };
  }, [rows, reviews]);

  const tiles = [
    { icon: Receipt, label: "Table orders", value: String(m.n), sub: `${m.served} served` },
    { icon: TrendingUp, label: "Revenue from tables", value: `${money(m.revenue)} EGP`, sub: `last ${days} days` },
    { icon: QrCode, label: "Average check", value: `${money(m.aov)} EGP`, sub: `${m.perOrder.toFixed(1)} items per order` },
    { icon: Layers, label: "Orders with add-ons", value: `${m.addOnRate.toFixed(0)}%`, sub: "more than one line" },
    { icon: Timer, label: "Order → ready", value: m.ready ? `${m.ready.toFixed(0)} min` : "—", sub: "average kitchen time" },
    { icon: Star, label: "Table chat rating", value: m.rating ? `${m.rating.toFixed(1)} / 5` : "—", sub: `${m.ratingN} ratings` },
  ];

  return (
    <div>
      <PageHeader title="Table ordering" subtitle="What the table QR chat brings in — orders, money and speed"
        actions={<div className="flex gap-1 rounded-xl border border-zinc-800 p-1">{[7, 30, 90].map((d) => (
          <button key={d} onClick={() => setDays(d)} className={`rounded-lg px-3 py-1.5 text-sm ${days === d ? "bg-zinc-100 text-zinc-900" : "text-zinc-400 hover:text-zinc-100"}`}>{d} days</button>))}</div>} />
      {orders === null ? <Empty text="Loading…" /> : m.n === 0 ? <Empty text="No table orders in this period yet." /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {tiles.map((t) => (
              <Card key={t.label} className="flex items-center gap-4 p-5">
                <div className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-500/10 text-emerald-400"><t.icon size={20} /></div>
                <div><div className="text-xs text-zinc-500">{t.label}</div><div className="text-2xl font-semibold">{t.value}</div><div className="text-xs text-zinc-500">{t.sub}</div></div>
              </Card>
            ))}
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <div className="mb-4 flex items-center gap-2 text-sm font-medium"><Clock size={16} className="text-emerald-400" />Busiest hours</div>
              <div className="flex h-40 items-end gap-1">
                {m.hours.map((v, h) => (
                  <div key={h} className="group flex h-full flex-1 flex-col items-center justify-end gap-1">
                    <div className="w-full rounded-t bg-emerald-500/70 transition group-hover:bg-emerald-400" style={{ height: `${(v / m.peak) * 85}%`, minHeight: v ? 4 : 0 }} title={`${h}:00 — ${v} orders`} />
                    <span className="text-[9px] text-zinc-600">{h % 3 === 0 ? h : ""}</span>
                  </div>
                ))}
              </div>
            </Card>
            <Card className="p-5">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium"><TrendingUp size={16} className="text-emerald-400" />Top items from tables</div>
              <div className="space-y-2">
                {m.top.map(([name, v]) => (
                  <div key={name} className="flex items-center gap-3 text-sm">
                    <div className="min-w-0 flex-1 truncate">{name}</div>
                    <div className="h-2 w-28 overflow-hidden rounded-full bg-zinc-800"><div className="h-full bg-emerald-500" style={{ width: `${(v.qty / m.top[0][1].qty) * 100}%` }} /></div>
                    <div className="w-10 text-right text-zinc-400">{v.qty}</div>
                  </div>
                ))}
              </div>
            </Card>
            <Card className="p-5 lg:col-span-2">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium"><Store size={16} className="text-emerald-400" />By branch</div>
              <div className="grid gap-2 sm:grid-cols-3">
                {Object.entries(m.byBranch).sort((a, b) => b[1].rev - a[1].rev).map(([b, v]) => (
                  <div key={b} className="rounded-xl border border-zinc-800 p-3"><div className="text-sm font-medium">{branchNames[b] || b}</div><div className="text-xs text-zinc-500">{v.n} orders · {money(v.rev)} EGP</div></div>
                ))}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
