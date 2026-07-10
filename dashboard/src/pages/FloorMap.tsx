import { useEffect, useState } from "react";
import { api } from "../config/api";
import { Card, PageHeader, Empty } from "../components/ui";

const CYCLE: Record<string, string> = {
  free: "seated",
  seated: "bill",
  bill: "cleaning",
  cleaning: "free",
  reserved: "seated",
  blocked: "free",
};

const TABLE_STYLES: Record<string, string> = {
  free: "border-emerald-500/50 bg-emerald-500/10 text-emerald-300",
  reserved: "border-amber-500/50 bg-amber-500/10 text-amber-300",
  seated: "border-sky-500/50 bg-sky-500/10 text-sky-300",
  bill: "border-purple-500/50 bg-purple-500/10 text-purple-300",
  cleaning: "border-zinc-600 bg-zinc-800/60 text-zinc-400",
  blocked: "border-red-500/50 bg-red-500/10 text-red-300",
};

export default function FloorMap() {
  const [tables, setTables] = useState<any[]>([]);

  const load = () => api.get("/api/tables").then((r) => setTables(r.data)).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  async function cycle(table: any) {
    const next = CYCLE[table.status] || "free";
    setTables((ts) => ts.map((x) => (x.id === table.id ? { ...x, status: next } : x)));
    await api.patch(`/api/tables/${table.id}`, { status: next }).catch(load);
  }

  const sections = [...new Set(tables.map((t) => t.section))];

  return (
    <div>
      <PageHeader
        title="Floor"
        subtitle="Tap a table to advance its state: free → seated → bill → cleaning → free"
      />
      <div className="mb-4 flex flex-wrap gap-3 text-xs">
        {Object.entries(TABLE_STYLES).map(([status, cls]) => (
          <span key={status} className={`rounded-full border px-2.5 py-1 ${cls}`}>{status}</span>
        ))}
      </div>
      {tables.length === 0 ? (
        <Card><Empty text="No tables configured" /></Card>
      ) : (
        sections.map((section) => (
          <div key={section} className="mb-8">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">{section}</h2>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-8">
              {tables.filter((t) => t.section === section).map((t) => (
                <button
                  key={t.id}
                  onClick={() => cycle(t)}
                  className={`aspect-square rounded-2xl border-2 p-2 text-center transition hover:scale-[1.03] ${TABLE_STYLES[t.status] || TABLE_STYLES.free}`}
                >
                  <div className="text-lg font-bold">{t.table_number}</div>
                  <div className="text-[11px] opacity-80">{t.capacity} seats{t.vip ? " ★" : ""}</div>
                  <div className="mt-1 text-[10px] uppercase tracking-wide opacity-70">{t.status}</div>
                </button>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
