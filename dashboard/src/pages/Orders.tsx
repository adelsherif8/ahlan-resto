import { useEffect, useMemo, useState } from "react";
import { api, session } from "../config/api";
import { Card, PageHeader, Empty } from "../components/ui";

// Fast-food ticket board (KDS): tickets flow left → right, one tap advances.
const COLS: { key: string; label: string; statuses: string[]; next?: string; nextLabel?: string }[] = [
  { key: "new", label: "🆕 New", statuses: ["pending", "accepted"], next: "preparing", nextLabel: "Start" },
  { key: "preparing", label: "🔥 On the grill", statuses: ["preparing"], next: "ready", nextLabel: "Ready" },
  { key: "ready", label: "✅ Ready", statuses: ["ready"], next: "served", nextLabel: "Handed over" },
  { key: "done", label: "🏁 Done", statuses: ["served", "delivered", "paid"] },
];

// Each order type gets its own paper-ticket colour, the way a real kitchen
// printer separates them at a glance. Tickets are printed paper — fixed light
// colours on purpose, they must look like paper in dark mode too.
const TYPE: Record<string, { label: string; icon: string; bar: string; chip: string }> = {
  dine_in:       { label: "DINE IN",  icon: "\u{1F374}", bar: "bg-sky-500",     chip: "bg-sky-100 text-sky-800" },
  table_reorder: { label: "DINE IN",  icon: "\u{1F374}", bar: "bg-sky-500",     chip: "bg-sky-100 text-sky-800" },
  pickup:        { label: "TAKEAWAY", icon: "\u{1F6CD}", bar: "bg-amber-500",   chip: "bg-amber-100 text-amber-800" },
  pre_order:     { label: "PRE-ORDER",icon: "\u{23F0}",  bar: "bg-emerald-500", chip: "bg-emerald-100 text-emerald-800" },
  delivery:      { label: "DELIVERY", icon: "\u{1F6F5}", bar: "bg-rose-500",    chip: "bg-rose-100 text-rose-800" },
};
const typeOf = (t: string) => TYPE[t] || { label: (t || "order").toUpperCase(), icon: "\u{1F9FE}", bar: "bg-neutral-500", chip: "bg-neutral-200 text-neutral-700" };

// serrated tear edge at the bottom of every ticket, like paper off the printer
const TEAR = {
  backgroundImage: "linear-gradient(-45deg, transparent 70%, #fbfaf4 71%), linear-gradient(45deg, transparent 70%, #fbfaf4 71%)",
  backgroundSize: "12px 8px",
  backgroundRepeat: "repeat-x",
} as const;

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
                      <div key={o.id} className="drop-shadow-md">
                        {/* the printed paper ticket — always paper-white, mono, dashed rules */}
                        <div
                          className={`overflow-hidden rounded-t-sm bg-[#fbfaf4] font-mono text-neutral-900 ${
                            late ? "ring-2 ring-red-500" : ""
                          }`}
                        >
                          {/* colour bar — the type is readable across the kitchen */}
                          <div className={`h-2 ${t.bar}`} />

                          <div className="flex items-center justify-between px-3 pt-2">
                            <span className="text-[11px] font-bold tracking-widest">
                              {t.icon} {t.label}
                              {o.order_type !== "delivery" && o.table_number ? ` · T${o.table_number}` : ""}
                            </span>
                            <span
                              className={`rounded-sm px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${
                                late ? "bg-red-600 text-white" : t.chip
                              }`}
                            >
                              {age}'
                            </span>
                          </div>

                          {/* the order number — big, like the top of a printed ticket */}
                          <div className="px-3 pb-1 pt-0.5 text-center">
                            <div className="text-2xl font-extrabold tracking-[0.15em]">{o.code}</div>
                            <div className="text-[10px] uppercase tracking-widest text-neutral-500">
                              {o.diner_name || o.phone_number || "guest"}
                              {o.branch && branch === "all" ? ` · ${branchName}` : ""}
                            </div>
                          </div>

                          {/* one line per item, modifiers underneath */}
                          <div className="divide-y divide-dashed divide-neutral-300 border-y border-dashed border-neutral-400">
                            {(o.items || []).map((i: any, idx: number) => {
                              const mods = [
                                ...Object.entries(i.options || {}).flatMap(([k, v]: [string, any]) =>
                                  k === "slots" && Array.isArray(v)
                                    ? v.map((sl: any, si: number) => `${si + 1}) ${Object.entries(sl || {}).filter(([f]) => f !== "notes").map(([, x]) => x).join(" + ")}${sl?.notes ? ` — ${sl.notes}` : ""}`)
                                    : [Array.isArray(v) ? v.join(", ") : v]),
                                i.notes || null,
                              ].filter(Boolean) as string[];
                              return (
                                <div key={idx} className="px-3 py-1.5 text-[13px] leading-snug">
                                  <div className="flex justify-between gap-2">
                                    <span className="font-bold">{i.qty}x {i.name}</span>
                                    <span className="tabular-nums text-neutral-500">
                                      {Number(i.unit_price ?? i.price) * Number(i.qty)}
                                    </span>
                                  </div>
                                  {mods.map((m, mi) => (
                                    <div key={mi} className="pl-3 text-xs font-semibold text-neutral-700">» {m}</div>
                                  ))}
                                </div>
                              );
                            })}
                          </div>

                          {o.notes && (
                            <div className="border-b border-dashed border-neutral-400 bg-amber-50 px-3 py-1.5 text-xs font-bold">
                              !! {o.notes}
                            </div>
                          )}
                          {o.order_type === "delivery" && o.address && (
                            <div className="border-b border-dashed border-neutral-400 px-3 py-1.5 text-xs">
                              📍 {o.address}
                              {o.map_link && (
                                <a href={o.map_link} target="_blank" rel="noreferrer" className="ml-1 font-bold underline">
                                  map
                                </a>
                              )}
                            </div>
                          )}

                          <div className="flex items-center justify-between px-3 py-2">
                            <span className="text-sm font-extrabold tabular-nums">
                              EGP {Number(o.total).toLocaleString()}
                              {o.payment_method && (
                                <span className="ml-1.5 text-[11px] font-normal uppercase text-neutral-500">{o.payment_method}</span>
                              )}
                            </span>
                            <div className="flex gap-1.5">
                              {col.key === "new" && (
                                <button
                                  onClick={() => advance(o, "cancelled")}
                                  className="rounded-sm border border-red-300 px-2 py-1 text-xs font-bold text-red-600 hover:bg-red-50"
                                >✕</button>
                              )}
                              {col.next && (
                                <button
                                  onClick={() => advance(o, col.next!)}
                                  className="rounded-sm bg-neutral-900 px-3 py-1 text-xs font-bold text-[#fbfaf4] hover:bg-neutral-700"
                                >{col.nextLabel}</button>
                              )}
                            </div>
                          </div>
                        </div>
                        {/* serrated tear-off edge */}
                        <div className="h-2" style={TEAR} />
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
