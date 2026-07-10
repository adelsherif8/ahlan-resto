import { useEffect, useState } from "react";
import { Plus, PartyPopper } from "lucide-react";
import { api } from "../config/api";
import { Card, PageHeader, Pill, Btn, Input, Empty } from "../components/ui";

export default function Events() {
  const [rows, setRows] = useState<any[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ title: "", date: "", start_time: "21:00", capacity: "", price: "", description: "" });

  const load = () => api.get("/api/events").then((r) => setRows(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    await api.post("/api/events", {
      ...form,
      capacity: form.capacity ? Number(form.capacity) : null,
      price: form.price ? Number(form.price) : null,
    });
    setShowNew(false);
    setForm({ title: "", date: "", start_time: "21:00", capacity: "", price: "", description: "" });
    load();
  }

  return (
    <div>
      <PageHeader
        title="Events"
        subtitle="DJ nights, tastings, private dining — the bot handles RSVPs"
        actions={<Btn onClick={() => setShowNew((v) => !v)}><span className="flex items-center gap-1.5"><Plus size={15} /> New event</span></Btn>}
      />

      {showNew && (
        <Card className="mb-5 p-5">
          <form onSubmit={create} className="grid gap-3 md:grid-cols-3">
            <Input placeholder="Title *" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <Input type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            <Input type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
            <Input type="number" placeholder="Capacity" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} />
            <Input type="number" placeholder="Price / ticket (optional)" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
            <Input placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <div className="md:col-span-3"><Btn type="submit">Create event</Btn></div>
          </form>
        </Card>
      )}

      {rows.length === 0 ? (
        <Card><Empty text="No events yet" /></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {rows.map((ev) => (
            <Card key={ev.id} className="p-5">
              <div className="mb-1 flex items-center justify-between">
                <div className="flex items-center gap-2 text-base font-semibold">
                  <PartyPopper size={16} className="text-amber-400" /> {ev.title}
                </div>
                <Pill value={ev.status} />
              </div>
              <div className="text-sm text-zinc-400">
                {ev.date}{ev.start_time ? ` · ${String(ev.start_time).slice(0, 5)}` : ""}
                {ev.price ? ` · EGP ${ev.price}` : " · Free entry"}
              </div>
              {ev.description && <div className="mt-1 text-sm text-zinc-500">{ev.description}</div>}
              {ev.capacity != null && (
                <div className="mt-3">
                  <div className="mb-1 flex justify-between text-xs text-zinc-400">
                    <span>RSVPs</span>
                    <span>{ev.rsvp_count}/{ev.capacity}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-amber-500"
                      style={{ width: `${Math.min(100, (ev.rsvp_count / Math.max(1, ev.capacity)) * 100)}%` }}
                    />
                  </div>
                </div>
              )}
              <div className="mt-3 text-xs text-zinc-500">
                {ev.broadcast_sent ? "📣 Broadcast sent" : "Broadcast not sent yet"}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
