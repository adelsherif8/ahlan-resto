import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, MessageCircle } from "lucide-react";
import { api } from "../config/api";
import { Card, PageHeader, Pill, Btn, Input, Select, Empty } from "../components/ui";

const NEXT_ACTIONS: Record<string, { label: string; to: string }[]> = {
  pending: [{ label: "Confirm", to: "confirmed" }, { label: "Cancel", to: "cancelled" }],
  awaiting_deposit: [{ label: "Mark paid", to: "confirmed" }, { label: "Cancel", to: "cancelled" }],
  confirmed: [{ label: "Arrived", to: "arrived" }, { label: "No-show", to: "no_show" }, { label: "Cancel", to: "cancelled" }],
  arrived: [{ label: "Seat", to: "seated" }],
  seated: [{ label: "Complete", to: "completed" }],
};

export default function Reservations() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<any[]>([]);
  const [live, setLive] = useState<any[]>([]);
  const [tables, setTables] = useState<any[]>([]);
  const [view, setView] = useState<"list" | "timeline">("list");
  const [filter, setFilter] = useState<"active" | "ended" | "all">("active");
  const [date, setDate] = useState(new Date().toLocaleDateString("en-CA"));
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ diner_name: "", diner_phone: "", party_size: "2", time_slot: "20:00", occasion: "", special_requests: "" });

  const load = () => api.get("/api/reservations", { params: { date } }).then((r) => setRows(r.data)).catch(() => {});
  useEffect(() => { load(); }, [date]);
  useEffect(() => {
    const loadLive = () => api.get("/api/reservations/live").then((r) => setLive(r.data)).catch(() => {});
    loadLive();
    api.get("/api/tables").then((r) => setTables(r.data || [])).catch(() => {});
    const t = setInterval(() => { loadLive(); load(); }, 10000);
    return () => clearInterval(t);
  }, [date]);

  const ENDED = ["cancelled", "no_show", "completed"];
  const filtered = useMemo(
    () => rows.filter((r) => filter === "all" ? true : filter === "ended" ? ENDED.includes(r.status) : !ENDED.includes(r.status)),
    [rows, filter]
  );
  const aiBooked = rows.filter((r) => r.source === "whatsapp" && !ENDED.includes(r.status)).length;

  const slots = useMemo(() => {
    const bySlot: Record<string, any[]> = {};
    for (const r of filtered) (bySlot[String(r.time_slot).slice(0, 5)] ||= []).push(r);
    return Object.entries(bySlot).sort(([a], [b]) => (a < b ? -1 : 1));
  }, [filtered]);

  async function setStatus(id: string, status: string) {
    await api.patch(`/api/reservations/${id}`, { status });
    load();
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    await api.post("/api/reservations", { ...form, party_size: Number(form.party_size), date, occasion: form.occasion || null });
    setShowNew(false);
    setForm({ ...form, diner_name: "", diner_phone: "", special_requests: "" });
    load();
  }

  return (
    <div>
      <PageHeader
        title="Reservations"
        subtitle={`${rows.length} bookings · ${rows.reduce((s, r) => s + (["cancelled", "no_show"].includes(r.status) ? 0 : r.party_size), 0)} covers${aiBooked ? ` · 🤖 ${aiBooked} booked by the AI` : ""}`}
        actions={
          <>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <Btn onClick={() => setShowNew((v) => !v)}><span className="flex items-center gap-1.5"><Plus size={15} /> New</span></Btn>
          </>
        }
      />

      {live.length > 0 && (
        <Card className="mb-5 border-emerald-500/40 p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-300">
            ⚡ Booking with the AI right now ({live.length})
          </div>
          <div className="flex flex-wrap gap-2">
            {live.map((s) => (
              <div key={s.phone_number} className="rounded-xl bg-zinc-900 px-3 py-2 text-xs">
                <span className="font-medium">{s.name || s.phone_number}</span>
                <span className="text-zinc-400">
                  {" — "}
                  {s.quoted
                    ? `quoted: ${s.quoted.date} ${String(s.quoted.time).slice(0, 5)} × ${s.quoted.party} (waiting for yes)`
                    : `${s.party_size ? s.party_size + " people" : "party ?"} · ${s.date || "day ?"} · ${s.time_slot ? String(s.time_slot).slice(0, 5) : "time ?"}`}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="mb-4 flex items-center gap-2">
        {([["active", "Active"], ["ended", "Cancelled & done"], ["all", "All"]] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`rounded-full px-3 py-1 text-xs transition ${filter === k ? "bg-amber-500/20 text-amber-300" : "bg-zinc-900 text-zinc-500 hover:text-zinc-300"}`}
          >
            {label}
          </button>
        ))}
        <div className="ml-auto flex gap-1 rounded-full bg-zinc-900 p-1">
          {([["list", "☰ List"], ["timeline", "▦ Timeline"]] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setView(k)}
              className={`rounded-full px-3 py-1 text-xs transition ${view === k ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {view === "timeline" && (
        <Timeline
          tables={tables}
          rows={rows.filter((r) => !ENDED.includes(r.status))}
          onAssign={async (resId: string, tableId: string) => {
            await api.patch(`/api/reservations/${resId}`, { table_id: tableId }).catch(() => {});
            load();
          }}
        />
      )}

      {showNew && (
        <Card className="mb-5 p-5">
          <form onSubmit={create} className="grid gap-3 md:grid-cols-3">
            <Input placeholder="Name" value={form.diner_name} onChange={(e) => setForm({ ...form, diner_name: e.target.value })} />
            <Input placeholder="Phone *" required value={form.diner_phone} onChange={(e) => setForm({ ...form, diner_phone: e.target.value })} />
            <div className="flex gap-3">
              <Input type="number" min={1} className="w-24" value={form.party_size} onChange={(e) => setForm({ ...form, party_size: e.target.value })} />
              <Input type="time" value={form.time_slot} onChange={(e) => setForm({ ...form, time_slot: e.target.value })} />
            </div>
            <Select value={form.occasion} onChange={(e) => setForm({ ...form, occasion: e.target.value })}>
              <option value="">No occasion</option>
              <option value="birthday">Birthday</option>
              <option value="anniversary">Anniversary</option>
              <option value="business">Business</option>
              <option value="date">Date night</option>
            </Select>
            <Input placeholder="Special requests" className="md:col-span-2" value={form.special_requests} onChange={(e) => setForm({ ...form, special_requests: e.target.value })} />
            <div className="md:col-span-3"><Btn type="submit">Create reservation</Btn></div>
          </form>
        </Card>
      )}

      {view === "list" && (rows.length === 0 ? (
        <Card><Empty text="No reservations for this date" /></Card>
      ) : (
        <div className="space-y-5">
          {slots.map(([slot, list]) => (
            <div key={slot}>
              <div className="mb-2 flex items-baseline gap-2 text-sm font-semibold text-amber-400">
                {slot}
                {tables.length > 0 && (
                  <span className="text-[11px] font-normal text-zinc-500">
                    {list.filter((r) => !ENDED.includes(r.status)).length}/{tables.length} tables
                  </span>
                )}
              </div>
              <div className="space-y-2">
                {list.map((r) => (
                  <Card key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-48">
                      <div className="text-sm font-medium">
                        {r.diner_display || r.diner_name || r.diner_phone}{" "}
                        <span className="text-zinc-500">· {r.party_size}p · {r.code}</span>
                        {r.table_number && (
                          <span className="ml-2 rounded-md bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-300" title={r.table_section || ""}>
                            {r.table_number}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-zinc-500">
                        {r.source === "whatsapp" ? "🤖 AI" : r.source}
                        {r.occasion && r.occasion !== "none" ? ` · ${r.occasion} 🎂` : ""}
                        {r.deposit_status === "paid" ? " · deposit ✓" : r.deposit_status === "pending" ? " · deposit pending" : ""}
                        {r.special_requests ? ` · "${r.special_requests}"` : ""}
                      </div>
                      {r.diner_allergies && (
                        <div className="mt-0.5 text-xs font-medium text-red-400">⚠️ {r.diner_allergies.join(", ")}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {r.source === "whatsapp" && (
                        <button
                          title="Open the WhatsApp conversation this booking came from"
                          onClick={() => navigate(`/chats?session=${encodeURIComponent(r.diner_phone)}`)}
                          className="rounded-lg border border-zinc-700 p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                        >
                          <MessageCircle size={14} />
                        </button>
                      )}
                      <Pill value={r.status} />
                      {(NEXT_ACTIONS[r.status] || []).map((a) => (
                        <Btn key={a.to} variant={a.to === "cancelled" || a.to === "no_show" ? "danger" : "ghost"} className="px-2.5 py-1.5 text-xs" onClick={() => setStatus(r.id, a.to)}>
                          {a.label}
                        </Btn>
                      ))}
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ---- Timeline: tables × hours, bookings as draggable blocks ----
const T_START = 12 * 60;           // 12:00
const T_END = 25 * 60;             // 01:00 next day
const PX_PER_HALF = 44;            // px per 30 min
const BLOCK_STYLES: Record<string, string> = {
  pending: "bg-zinc-600/70 border-zinc-500",
  confirmed: "bg-amber-500/70 border-amber-400",
  reminded: "bg-amber-500/70 border-amber-400",
  arrived: "bg-sky-500/70 border-sky-400",
  seated: "bg-emerald-500/70 border-emerald-400",
};

function Timeline({ tables, rows, onAssign }: { tables: any[]; rows: any[]; onAssign: (resId: string, tableId: string) => void }) {
  const toMin = (t: string) => {
    const [h, m] = String(t).slice(0, 5).split(":").map(Number);
    const v = h * 60 + (m || 0);
    return v < T_START ? v + 1440 : v; // 00:30 belongs to the overnight tail
  };
  const width = ((T_END - T_START) / 30) * PX_PER_HALF;
  const hours: number[] = [];
  for (let t = T_START; t <= T_END; t += 60) hours.push(t);
  const unassigned = rows.filter((r) => !r.table_id);
  const block = (r: any) => {
    const start = toMin(r.time_slot);
    const end = r.end_slot ? toMin(r.end_slot) : start + 105;
    return (
      <div
        key={r.id}
        draggable
        onDragStart={(e) => e.dataTransfer.setData("resId", r.id)}
        title={`${r.diner_display || r.diner_name || r.diner_phone} · ${r.party_size}p · ${r.code}${r.diner_allergies ? ` · ⚠️ ${r.diner_allergies.join(",")}` : ""}`}
        className={`absolute top-1 flex h-7 cursor-grab items-center overflow-hidden rounded-lg border px-1.5 text-[11px] font-medium text-zinc-950 ${BLOCK_STYLES[r.status] || BLOCK_STYLES.pending}`}
        style={{ left: ((start - T_START) / 30) * PX_PER_HALF, width: Math.max(((end - start) / 30) * PX_PER_HALF - 2, 40) }}
      >
        {r.party_size}p {(r.diner_display || r.diner_name || "").split(" ")[0]}{r.occasion && r.occasion !== "none" ? " 🎂" : ""}
      </div>
    );
  };
  return (
    <Card className="mb-5 overflow-x-auto p-4">
      <div style={{ width: width + 64 }}>
        <div className="mb-1 flex">
          <div className="w-16 shrink-0" />
          <div className="relative h-5" style={{ width }}>
            {hours.map((t) => (
              <span key={t} className="absolute text-[10px] text-zinc-500" style={{ left: ((t - T_START) / 30) * PX_PER_HALF }}>
                {String(Math.floor((t % 1440) / 60)).padStart(2, "0")}:00
              </span>
            ))}
          </div>
        </div>
        {unassigned.length > 0 && (
          <div className="flex items-center border-b border-dashed border-zinc-700">
            <div className="w-16 shrink-0 py-2 text-[11px] text-amber-400">no table</div>
            <div className="relative h-9" style={{ width }}>{unassigned.map(block)}</div>
          </div>
        )}
        {tables.map((t) => (
          <div
            key={t.id}
            className="flex items-center border-b border-zinc-800/60"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              const resId = e.dataTransfer.getData("resId");
              if (resId) onAssign(resId, t.id);
            }}
          >
            <div className="w-16 shrink-0 py-2 text-[11px] text-zinc-400">
              {t.table_number} <span className="text-zinc-600">·{t.capacity}</span>
            </div>
            <div className="relative h-9" style={{ width }}>
              {rows.filter((r) => r.table_id === t.id).map(block)}
            </div>
          </div>
        ))}
        <div className="mt-2 text-[10px] text-zinc-600">Drag a block onto another table row to reassign it.</div>
      </div>
    </Card>
  );
}
