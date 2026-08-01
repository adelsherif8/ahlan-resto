import { useEffect, useMemo, useState } from "react";
import { api, session } from "../config/api";
import { Card, PageHeader, Btn, Empty } from "../components/ui";

// Fast-food ticket board (KDS): tickets flow left → right, one tap advances.
const COLS: { key: string; label: string; statuses: string[]; next?: string; nextLabel?: string }[] = [
  { key: "new", label: "🆕 New", statuses: ["pending", "accepted"], next: "preparing", nextLabel: "Start" },
  { key: "preparing", label: "🔥 On the grill", statuses: ["preparing"], next: "ready", nextLabel: "Ready" },
  { key: "ready", label: "✅ Ready", statuses: ["ready"], next: "served", nextLabel: "Handed over" },
  { key: "done", label: "🏁 Done", statuses: ["served", "delivered", "paid"] },
];

// Each order type gets its own paper-ticket colour, the way a real kitchen
// printer separates them at a glance.
const TYPE: Record<string, { label: string; icon: string; bar: string; chip: string }> = {
  dine_in:       { label: "Dine in",  icon: "\u{1F374}", bar: "bg-sky-400",     chip: "bg-sky-500/15 text-sky-300" },
  table_reorder: { label: "Dine in",  icon: "\u{1F374}", bar: "bg-sky-400",     chip: "bg-sky-500/15 text-sky-300" },
  pickup:        { label: "Takeaway", icon: "\u{1F6CD}", bar: "bg-amber-400",   chip: "bg-amber-500/15 text-amber-300" },
  pre_order:     { label: "Pre-order",icon: "\u{23F0}",  bar: "bg-emerald-400", chip: "bg-emerald-500/15 text-emerald-300" },
  delivery:      { label: "Delivery", icon: "\u{1F6F5}", bar: "bg-rose-400",    chip: "bg-rose-500/15 text-rose-300" },
};
const typeOf = (t: string) => TYPE[t] || { label: t || "order", icon: "\u{1F9FE}", bar: "bg-zinc-500", chip: "bg-zinc-800 text-zinc-300" };

function mins(since: string) {
  return Math.max(0, Math.round((Date.now() - new Date(since).getTime()) / 60000));
}

export default function Orders() {
  const [rows, setRows] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const staffBranch = session().branch || "";
  const [branch, setBranch] = useState<string>(staffBranch || localStorage.getItem("resto_branch_view") || "all");

  const load = (b = branch) =>
    api.get("/api/orders", { params: { branch: b } }).then((r) => setRows(r.data)).catch(() => {});
  useEffect(() => {
    api.get("/api/settings").then((r) => setBranches(r.data?.basic_info?.branches || [])).catch(() => {});
  }, []);
  useEffect(() => {
    load(branch);
    if (!staffBranch) localStorage.setItem("resto_branch_view", branch);
    const t = setInterval(() => load(branch), 7000);
    return () => clearInterval(t);
  }, [branch]);

  async function advance(o: any, status: string) {
    setRows((xs) => xs.map((x) => (x.id === o.id ? { ...x, status } : x)));
    await api.patch(`/api/orders/${o.id}`, { status }).catch(load);
  }

  const today = new Date().toLocaleDateString("en-CA");
  const visible = useMemo(
    () => rows.filter((o) => o.status !== "cancelled" && String(o.created_at).slice(0, 10) === today),
    [rows]
  );
  const active = visible.filter((o) => !COLS[3].statuses.includes(o.status));

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Orders"
        subtitle={`${active.length} live tickets · ${visible.length} today · EGP ${visible.reduce((s, o) => s + Number(o.total || 0), 0).toLocaleString()}`}
        actions={
          branches.length > 1 ? (
            staffBranch ? (
              <span className="rounded-full bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300">
                🏪 {branches.find((b: any) => b.key === staffBranch)?.name || staffBranch}
              </span>
            ) : (
              <select
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
              >
                <option value="all">All branches</option>
                {branches.map((b: any) => (
                  <option key={b.key} value={b.key}>{b.name}</option>
                ))}
              </select>
            )
          ) : undefined
        }
      />
      <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-4">
        {COLS.map((col) => {
          const list = visible.filter((o) => col.statuses.includes(o.status));
          return (
            <div key={col.key} className="flex min-h-0 flex-col">
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-sm font-semibold">{col.label}</span>
                <span className="text-xs text-zinc-500">{list.length}</span>
              </div>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                {list.length === 0 ? (
                  <Card className="p-4"><Empty text="—" /></Card>
                ) : (
                  list.map((o) => {
                    const age = mins(o.created_at);
                    const late = col.key !== "done" && age > 20;
                    const t = typeOf(o.order_type);
                    const branchName = branches.find((b: any) => b.key === o.branch)?.name || o.branch;
                    return (
                      <div
                        key={o.id}
                        className={`overflow-hidden rounded-xl border bg-zinc-900/70 shadow-sm ${late ? "border-red-500/70" : "border-zinc-800"}`}
                      >
                        {/* colour bar — the type is readable across the kitchen */}
                        <div className={`h-1.5 ${t.bar}`} />

                        <div className="flex items-center justify-between px-3 py-2">
                          <span className="flex items-center gap-1.5 text-sm font-semibold">
                            <span>{t.icon}</span>
                            {t.label}
                            {o.order_type !== "delivery" && o.table_number ? (
                              <span className="text-zinc-400">· {o.table_number}</span>
                            ) : null}
                          </span>
                          <span
                            className={`rounded-md px-2 py-0.5 text-xs font-bold tabular-nums ${
                              late ? "bg-red-500/20 text-red-300" : t.chip
                            }`}
                          >
                            {age} min
                          </span>
                        </div>

                        <div className="border-t border-dashed border-zinc-800 px-3 py-1.5 text-xs text-zinc-400">
                          <span className="font-mono font-semibold text-zinc-300">{o.code}</span>
                          {" · "}
                          {o.diner_name || o.phone_number || "guest"}
                          {o.branch && branch === "all" ? ` · 🏪 ${branchName}` : ""}
                        </div>

                        {/* one torn-paper line per item, modifiers underneath */}
                        <div className="divide-y divide-dashed divide-zinc-800 border-y border-dashed border-zinc-800">
                          {(o.items || []).map((i: any, idx: number) => {
                            const mods = [
                              ...Object.entries(i.options || {}).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`),
                              i.notes || null,
                            ].filter(Boolean) as string[];
                            return (
                              <div key={idx} className="px-3 py-1.5 text-sm">
                                <div className="flex justify-between gap-2">
                                  <span>
                                    <span className="font-bold">{i.qty}×</span> {i.name}
                                  </span>
                                  <span className="tabular-nums text-zinc-500">
                                    {Number(i.unit_price ?? i.price) * Number(i.qty)}
                                  </span>
                                </div>
                                {mods.length > 0 && (
                                  <div className="mt-0.5 text-xs font-medium text-amber-300">↳ {mods.join(" · ")}</div>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {o.notes && (
                          <div className="mx-3 mt-2 rounded-lg bg-amber-500/10 px-2 py-1.5 text-xs text-amber-300">
                            📝 {o.notes}
                          </div>
                        )}
                        {o.order_type === "delivery" && o.address && (
                          <div className="mx-3 mt-2 rounded-lg bg-zinc-800/60 px-2 py-1.5 text-xs text-zinc-300">
                            📍 {o.address}
                            {o.map_link && (
                              <a href={o.map_link} target="_blank" rel="noreferrer" className="ml-1 underline">
                                map
                              </a>
                            )}
                          </div>
                        )}

                        <div className="flex items-center justify-between px-3 py-2.5">
                          <span className="text-sm font-bold tabular-nums">
                            EGP {Number(o.total).toLocaleString()}
                            {o.payment_method && (
                              <span className="ml-1.5 font-normal text-zinc-500">· {o.payment_method}</span>
                            )}
                          </span>
                          <div className="flex gap-1.5">
                            {col.key === "new" && (
                              <Btn variant="danger" className="px-2 py-1 text-xs" onClick={() => advance(o, "cancelled")}>✕</Btn>
                            )}
                            {col.next && (
                              <Btn className="px-3 py-1 text-xs" onClick={() => advance(o, col.next!)}>{col.nextLabel}</Btn>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
