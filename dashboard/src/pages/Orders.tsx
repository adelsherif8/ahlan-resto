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

const TYPE_BADGE: Record<string, string> = {
  dine_in: "bg-sky-500/20 text-sky-300",
  pickup: "bg-amber-500/20 text-amber-300",
  delivery: "bg-purple-500/20 text-purple-300",
  pre_order: "bg-emerald-500/20 text-emerald-300",
  table_reorder: "bg-sky-500/20 text-sky-300",
};

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
                    return (
                      <Card key={o.id} className={`p-3 ${late ? "border-red-500/60" : ""}`}>
                        <div className="mb-1 flex items-center justify-between">
                          <span className="font-mono text-sm font-bold">{o.code}</span>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${TYPE_BADGE[o.order_type] || "bg-zinc-800 text-zinc-300"}`}>
                            {o.order_type === "dine_in" ? `🍽 ${o.table_number || "table"}` : o.order_type}
                          </span>
                        </div>
                        <div className="mb-1 text-xs text-zinc-400">
                          {o.branch && branch === "all" ? `🏪 ${branches.find((b: any) => b.key === o.branch)?.name || o.branch} · ` : ""}
                          {o.diner_name || o.phone_number || "guest"} · <span className={late ? "font-semibold text-red-400" : ""}>{age}m</span>
                        </div>
                        <div className="space-y-0.5 text-sm">
                          {(o.items || []).map((i: any, idx: number) => (
                            <div key={idx} className="flex justify-between gap-2">
                              <span><span className="font-semibold">{i.qty}×</span> {i.name}</span>
                              <span className="text-zinc-500">{Number(i.price) * Number(i.qty)}</span>
                            </div>
                          ))}
                        </div>
                        {o.notes && <div className="mt-1 rounded-lg bg-amber-500/10 px-2 py-1 text-xs text-amber-300">📝 {o.notes}</div>}
                        <div className="mt-2 flex items-center justify-between">
                          <span className="text-sm font-bold tabular-nums">EGP {Number(o.total).toLocaleString()}</span>
                          <div className="flex gap-1.5">
                            {col.key === "new" && (
                              <Btn variant="danger" className="px-2 py-1 text-xs" onClick={() => advance(o, "cancelled")}>✕</Btn>
                            )}
                            {col.next && (
                              <Btn className="px-2.5 py-1 text-xs" onClick={() => advance(o, col.next!)}>{col.nextLabel}</Btn>
                            )}
                          </div>
                        </div>
                      </Card>
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
