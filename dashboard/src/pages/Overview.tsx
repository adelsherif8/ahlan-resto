import { useEffect, useState } from "react";
import { api } from "../config/api";
import { Card, PageHeader, Pill, Empty } from "../components/ui";

type Kpis = {
  covers_today: number;
  reservations_today: number;
  pending_deposits: number;
  waitlist_now: number;
  tables_seated: number;
  tables_total: number;
  open_orders: number;
  needs_attention: number;
  no_show_rate_pct: number;
  avg_rating: string | null;
  by_slot: { slot: string; covers: number }[];
  upcoming: any[];
};

export default function Overview() {
  const [kpis, setKpis] = useState<Kpis | null>(null);

  useEffect(() => {
    const load = () => api.get("/api/dashboard/kpis").then((r) => setKpis(r.data)).catch(() => {});
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  if (!kpis) return <Empty text="Loading…" />;

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

  const maxCovers = Math.max(1, ...kpis.by_slot.map((s) => s.covers));

  return (
    <div>
      <PageHeader title="Overview" subtitle="Tonight at a glance" />
      {kpis.needs_attention > 0 && (
        <div className="mb-5 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          {kpis.needs_attention} conversation{kpis.needs_attention > 1 ? "s" : ""} need a human — check Chats.
        </div>
      )}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="p-5">
            <div className="text-3xl font-bold tabular-nums">{s.value}</div>
            <div className="mt-1 text-xs uppercase tracking-wide text-zinc-500">{s.label}</div>
          </Card>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-4 text-sm font-semibold text-zinc-300">Covers by slot (today)</h2>
          {kpis.by_slot.length === 0 ? (
            <Empty text="No reservations today yet" />
          ) : (
            <div className="flex h-40 items-end gap-2">
              {kpis.by_slot.map((s) => (
                <div key={s.slot} className="flex flex-1 flex-col items-center gap-1">
                  <div className="text-xs text-zinc-400">{s.covers}</div>
                  <div
                    className="w-full rounded-t-lg bg-amber-500/80"
                    style={{ height: `${(s.covers / maxCovers) * 100}%` }}
                  />
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
              {kpis.upcoming.map((r) => (
                <div key={r.id} className="flex items-center justify-between rounded-xl bg-zinc-900 px-3 py-2.5">
                  <div>
                    <div className="text-sm font-medium">
                      {r.diner_name || r.diner_phone} · {r.party_size}p
                    </div>
                    <div className="text-xs text-zinc-500">
                      {r.date} {String(r.time_slot).slice(0, 5)}
                      {r.occasion ? ` · ${r.occasion} 🎉` : ""}
                    </div>
                  </div>
                  <Pill value={r.status} />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
