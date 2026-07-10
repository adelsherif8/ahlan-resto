import { useEffect, useState } from "react";
import { api } from "../config/api";
import { Card, PageHeader, Pill, Btn, Empty } from "../components/ui";

const FLOW = ["pending", "accepted", "preparing", "ready", "served", "paid"];

export default function Orders() {
  const [rows, setRows] = useState<any[]>([]);

  const load = () => api.get("/api/orders").then((r) => setRows(r.data)).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, []);

  async function advance(o: any) {
    const idx = FLOW.indexOf(o.status);
    const next = FLOW[Math.min(idx + 1, FLOW.length - 1)];
    await api.patch(`/api/orders/${o.id}`, { status: next });
    load();
  }

  const open = rows.filter((o) => !["paid", "cancelled"].includes(o.status));
  const closed = rows.filter((o) => ["paid", "cancelled"].includes(o.status));

  return (
    <div>
      <PageHeader title="Orders" subtitle={`${open.length} open`} />
      {open.length === 0 ? (
        <Card><Empty text="No open orders" /></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {open.map((o) => (
            <Card key={o.id} className="flex flex-col p-4">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-bold">{o.code} <span className="font-normal text-zinc-500">· {o.order_type.replaceAll("_", " ")}{o.table_number ? ` · ${o.table_number}` : ""}</span></div>
                <Pill value={o.status} />
              </div>
              <div className="mb-2 text-xs text-zinc-400">{o.diner_name || o.phone_number}</div>
              <div className="flex-1 space-y-1">
                {(o.items || []).map((it: any, i: number) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span>{it.qty}× {it.name}</span>
                    <span className="tabular-nums text-zinc-400">{it.qty * it.price}</span>
                  </div>
                ))}
              </div>
              {o.notes && <div className="mt-2 rounded-lg bg-zinc-900 px-2 py-1 text-xs text-amber-300">📝 {o.notes}</div>}
              <div className="mt-3 flex items-center justify-between border-t border-zinc-800 pt-3">
                <div className="text-sm font-semibold tabular-nums">EGP {Number(o.total).toFixed(0)}</div>
                {o.status !== "paid" && (
                  <Btn className="px-3 py-1.5 text-xs" onClick={() => advance(o)}>
                    → {FLOW[Math.min(FLOW.indexOf(o.status) + 1, FLOW.length - 1)]}
                  </Btn>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
      {closed.length > 0 && (
        <>
          <h2 className="mb-2 mt-8 text-sm font-semibold text-zinc-400">Closed</h2>
          <div className="space-y-2">
            {closed.map((o) => (
              <Card key={o.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span>{o.code} · {o.diner_name || o.phone_number} · EGP {Number(o.total).toFixed(0)}</span>
                <Pill value={o.status} />
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
