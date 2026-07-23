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
  const [nextByTable, setNextByTable] = useState<Record<string, any>>({});

  const load = () => api.get("/api/tables").then((r) => setTables(r.data)).catch(() => {});
  const loadBookings = () =>
    api.get("/api/reservations", { params: { date: new Date().toLocaleDateString("en-CA") } }).then((r) => {
      const now = new Date().toTimeString().slice(0, 5);
      const next: Record<string, any> = {};
      for (const res of r.data || []) {
        if (!res.table_id || !["confirmed", "reminded", "arrived"].includes(res.status)) continue;
        const t = String(res.time_slot).slice(0, 5);
        if (t < now && res.status === "confirmed") continue; // already past
        if (!next[res.table_id] || t < String(next[res.table_id].time_slot).slice(0, 5)) next[res.table_id] = res;
      }
      setNextByTable(next);
    }).catch(() => {});
  useEffect(() => {
    load(); loadBookings();
    const t = setInterval(() => { load(); loadBookings(); }, 10000);
    return () => clearInterval(t);
  }, []);

  async function cycle(table: any) {
    const next = CYCLE[table.status] || "free";
    setTables((ts) => ts.map((x) => (x.id === table.id ? { ...x, status: next } : x)));
    await api.patch(`/api/tables/${table.id}`, { status: next }).catch(load);
  }

  // one-tap walk-in: seats a party on a free table + records it as a real reservation
  async function walkIn(e: React.MouseEvent, table: any) {
    e.stopPropagation();
    const party = Number(prompt(`Walk-in party size for ${table.table_number}?`, "2"));
    if (!party || party < 1) return;
    const now = new Date();
    await api.post("/api/reservations", {
      diner_name: "Walk-in",
      diner_phone: `walkin:${now.getTime().toString(36)}`,
      party_size: party,
      date: now.toLocaleDateString("en-CA"),
      time_slot: now.toTimeString().slice(0, 5),
      status: "seated",
      source: "walk_in",
      table_id: table.id,
    }).catch(() => {});
    await api.patch(`/api/tables/${table.id}`, { status: "seated" }).catch(() => {});
    load(); loadBookings();
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
                  className={`relative aspect-square rounded-2xl border-2 p-2 text-center transition hover:scale-[1.03] ${TABLE_STYLES[t.status] || TABLE_STYLES.free}`}
                >
                  {t.status === "free" && (
                    <span
                      onClick={(e) => walkIn(e, t)}
                      title="Seat a walk-in here"
                      className="absolute right-1 top-1 rounded-md bg-zinc-800/80 px-1.5 text-[11px] text-zinc-300 hover:bg-zinc-700"
                    >
                      +👥
                    </span>
                  )}
                  <div className="text-lg font-bold">{t.table_number}</div>
                  <div className="text-[11px] opacity-80">{t.capacity} seats{t.vip ? " ★" : ""}</div>
                  <div className="mt-1 text-[10px] uppercase tracking-wide opacity-70">{t.status}</div>
                  {nextByTable[t.id] && (
                    <div className="mt-0.5 truncate text-[10px] text-amber-300" title={`${nextByTable[t.id].diner_display || nextByTable[t.id].diner_phone} — ${nextByTable[t.id].code}`}>
                      📅 {String(nextByTable[t.id].time_slot).slice(0, 5)} ×{nextByTable[t.id].party_size}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
