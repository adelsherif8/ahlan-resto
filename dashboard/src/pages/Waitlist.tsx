import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { api } from "../config/api";
import { Card, PageHeader, Pill, Btn, Input, Empty } from "../components/ui";
import { usePoll } from "../lib/usePoll";

function minsAgo(iso: string) {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

export default function Waitlist() {
  const [rows, setRows] = useState<any[]>([]);
  const [form, setForm] = useState({ name: "", phone_number: "", party_size: "2", quoted_wait_min: "20" });

  const load = () => api.get("/api/waitlist").then((r) => setRows(r.data)).catch(() => {});
  usePoll(load, 10000);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    await api.post("/api/waitlist", { ...form, party_size: Number(form.party_size), quoted_wait_min: Number(form.quoted_wait_min) });
    setForm({ ...form, name: "", phone_number: "" });
    load();
  }

  async function setStatus(id: string, status: string) {
    await api.patch(`/api/waitlist/${id}`, { status });
    load();
  }

  return (
    <div>
      <PageHeader title="Waitlist" subtitle={`${rows.length} parties waiting`} />
      <Card className="mb-5 p-4">
        <form onSubmit={add} className="flex flex-wrap items-center gap-3">
          <Input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input placeholder="Phone *" required value={form.phone_number} onChange={(e) => setForm({ ...form, phone_number: e.target.value })} />
          <Input type="number" min={1} className="w-20" value={form.party_size} onChange={(e) => setForm({ ...form, party_size: e.target.value })} />
          <Input type="number" min={0} step={5} className="w-24" title="Quoted wait (min)" value={form.quoted_wait_min} onChange={(e) => setForm({ ...form, quoted_wait_min: e.target.value })} />
          <Btn type="submit"><span className="flex items-center gap-1.5"><Plus size={15} /> Add</span></Btn>
        </form>
      </Card>

      {rows.length === 0 ? (
        <Card><Empty text="Waitlist is empty 🎉" /></Card>
      ) : (
        <div className="space-y-2">
          {rows.map((w, i) => (
            <Card key={w.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="flex items-center gap-4">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-800 text-sm font-bold text-amber-400">
                  {i + 1}
                </div>
                <div>
                  <div className="text-sm font-medium">{w.name || w.phone_number} · {w.party_size}p</div>
                  <div className="text-xs text-zinc-500">
                    waiting {minsAgo(w.created_at)} min
                    {w.quoted_wait_min ? ` · quoted ${w.quoted_wait_min} min` : ""}
                    {w.notified_at ? ` · notified ${minsAgo(w.notified_at)} min ago` : ""}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Pill value={w.status} />
                {w.status === "waiting" && (
                  <Btn variant="ghost" className="px-2.5 py-1.5 text-xs" onClick={() => setStatus(w.id, "notified")}>
                    Notify (table ready)
                  </Btn>
                )}
                {["waiting", "notified"].includes(w.status) && (
                  <>
                    <Btn variant="ghost" className="px-2.5 py-1.5 text-xs" onClick={() => setStatus(w.id, "seated")}>Seat</Btn>
                    <Btn variant="danger" className="px-2.5 py-1.5 text-xs" onClick={() => setStatus(w.id, "left")}>Left</Btn>
                  </>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
