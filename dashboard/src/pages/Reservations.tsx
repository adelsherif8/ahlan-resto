import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
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
  const [rows, setRows] = useState<any[]>([]);
  const [date, setDate] = useState(new Date().toLocaleDateString("en-CA"));
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ diner_name: "", diner_phone: "", party_size: "2", time_slot: "20:00", occasion: "", special_requests: "" });

  const load = () => api.get("/api/reservations", { params: { date } }).then((r) => setRows(r.data)).catch(() => {});
  useEffect(() => { load(); }, [date]);

  const slots = useMemo(() => {
    const bySlot: Record<string, any[]> = {};
    for (const r of rows) (bySlot[String(r.time_slot).slice(0, 5)] ||= []).push(r);
    return Object.entries(bySlot).sort(([a], [b]) => (a < b ? -1 : 1));
  }, [rows]);

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
        subtitle={`${rows.length} bookings · ${rows.reduce((s, r) => s + (["cancelled", "no_show"].includes(r.status) ? 0 : r.party_size), 0)} covers`}
        actions={
          <>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <Btn onClick={() => setShowNew((v) => !v)}><span className="flex items-center gap-1.5"><Plus size={15} /> New</span></Btn>
          </>
        }
      />

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

      {rows.length === 0 ? (
        <Card><Empty text="No reservations for this date" /></Card>
      ) : (
        <div className="space-y-5">
          {slots.map(([slot, list]) => (
            <div key={slot}>
              <div className="mb-2 text-sm font-semibold text-amber-400">{slot}</div>
              <div className="space-y-2">
                {list.map((r) => (
                  <Card key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-48">
                      <div className="text-sm font-medium">
                        {r.diner_name || r.diner_phone} <span className="text-zinc-500">· {r.party_size}p · {r.code}</span>
                      </div>
                      <div className="text-xs text-zinc-500">
                        {r.source}
                        {r.occasion ? ` · ${r.occasion} 🎂` : ""}
                        {r.deposit_status === "paid" ? " · deposit ✓" : r.deposit_status === "pending" ? " · deposit pending" : ""}
                        {r.special_requests ? ` · "${r.special_requests}"` : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
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
      )}
    </div>
  );
}
