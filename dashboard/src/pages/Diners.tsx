import { useEffect, useState } from "react";
import { Search, Star } from "lucide-react";
import { api } from "../config/api";
import { Card, PageHeader, Pill, Input, Empty } from "../components/ui";

export default function Diners() {
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<any | null>(null);

  useEffect(() => {
    const t = setTimeout(
      () => api.get("/api/diners", { params: { q } }).then((r) => setRows(r.data)).catch(() => {}),
      200
    );
    return () => clearTimeout(t);
  }, [q]);

  async function open(id: string) {
    const { data } = await api.get(`/api/diners/${id}`);
    setSelected(data);
  }

  async function savePrefs(patch: any) {
    if (!selected) return;
    const preferences = { ...(selected.preferences || {}), ...patch };
    await api.patch(`/api/diners/${selected.id}`, { preferences });
    setSelected({ ...selected, preferences });
  }

  return (
    <div>
      <PageHeader
        title="Diners"
        subtitle="Your guest CRM — the bot remembers all of this"
        actions={
          <div className="relative">
            <Search size={15} className="absolute left-3 top-2.5 text-zinc-500" />
            <Input placeholder="Search name, phone, tag…" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        }
      />
      <div className="grid gap-5 lg:grid-cols-5">
        <div className="space-y-2 lg:col-span-3">
          {rows.length === 0 ? (
            <Card><Empty text="No diners found" /></Card>
          ) : (
            rows.map((d) => (
              <Card
                key={d.id}
                className={`cursor-pointer px-4 py-3 transition hover:border-zinc-600 ${selected?.id === d.id ? "border-amber-500/60" : ""}`}
              >
                <div onClick={() => open(d.id)} className="flex items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {d.name || d.wa_profile_name || d.phone_number}
                      {d.is_vip && <Star size={13} className="fill-fuchsia-400 text-fuchsia-400" />}
                    </div>
                    <div className="text-xs text-zinc-500">
                      {d.phone_number} · {d.visit_count} visits · EGP {Number(d.total_spend).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {(d.tags || []).slice(0, 2).map((t: string) => (
                      <span key={t} className="rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-300">{t}</span>
                    ))}
                    <Pill value={d.status} />
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>

        <div className="lg:col-span-2">
          {selected ? (
            <Card className="sticky top-0 p-5">
              <div className="mb-1 flex items-center gap-2 text-lg font-semibold">
                {selected.name || selected.wa_profile_name || selected.phone_number}
                {selected.is_vip && <Star size={15} className="fill-fuchsia-400 text-fuchsia-400" />}
              </div>
              <div className="mb-4 text-sm text-zinc-500">{selected.phone_number}</div>
              <dl className="space-y-3 text-sm">
                <Row k="Visits" v={String(selected.visit_count)} />
                <Row k="Total spend" v={`EGP ${Number(selected.total_spend).toLocaleString()}`} />
                {selected.allergies?.length > 0 && <Row k="Allergies ⚠️" v={selected.allergies.join(", ")} />}
                {selected.preferences?.favorite_table && <Row k="Favorite table" v={selected.preferences.favorite_table} />}
                {selected.preferences?.favorite_items?.length > 0 && <Row k="Always orders" v={selected.preferences.favorite_items.join(", ")} />}
                {selected.preferences?.occasions?.birthday && <Row k="Birthday" v={selected.preferences.occasions.birthday} />}
                {selected.preferences?.seating && <Row k="Prefers seating" v={selected.preferences.seating} />}
                {selected.preferences?.facts?.length > 0 && <Row k="Known facts" v={selected.preferences.facts.join(" · ")} />}
                {selected.preferences?.ai_notes?.length > 0 && <Row k="🤖 AI observations" v={selected.preferences.ai_notes.join(" · ")} />}
                {selected.notes && <Row k="Notes" v={selected.notes} />}
              </dl>
              <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-zinc-400">Edit (the bot uses these)</h3>
              <EditRow label="Allergies (comma-sep)" value={(selected.allergies || []).join(", ")} onSave={async (v) => {
                const allergies = v.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
                await api.patch(`/api/diners/${selected.id}`, { allergies });
                setSelected({ ...selected, allergies });
              }} />
              <EditRow label="Tags (comma-sep)" value={(selected.tags || []).join(", ")} onSave={async (v) => {
                const tags = v.split(",").map((x) => x.trim()).filter(Boolean);
                await api.patch(`/api/diners/${selected.id}`, { tags });
                setSelected({ ...selected, tags });
              }} />
              <EditRow label="Notes" value={selected.notes || ""} onSave={async (v) => {
                await api.patch(`/api/diners/${selected.id}`, { notes: v });
                setSelected({ ...selected, notes: v });
              }} />
              <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-zinc-400">Memory (captured by the bot — correct it here)</h3>
              <EditRow label="Favorite dishes (comma-sep)" value={(selected.preferences?.favorite_items || []).join(", ")} onSave={(v) =>
                savePrefs({ favorite_items: v.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 5) })
              } />
              <EditRow label="Seating preference (indoor / outdoor / terrace / quiet / window / bar)" value={selected.preferences?.seating || ""} onSave={(v) =>
                savePrefs({ seating: v.trim().toLowerCase() || undefined })
              } />
              <EditRow label="Birthday (MM-DD)" value={selected.preferences?.occasions?.birthday || ""} onSave={(v) =>
                savePrefs({ occasions: { ...(selected.preferences?.occasions || {}), birthday: v.trim() || undefined } })
              } />
              <EditRow label="Anniversary (MM-DD)" value={selected.preferences?.occasions?.anniversary || ""} onSave={(v) =>
                savePrefs({ occasions: { ...(selected.preferences?.occasions || {}), anniversary: v.trim() || undefined } })
              } />
              <EditRow label="Facts about them (comma-sep, max 10)" value={(selected.preferences?.facts || []).join(", ")} onSave={(v) =>
                savePrefs({ facts: v.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 10) })
              } />
              <label className="mt-2 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!selected.is_vip} onChange={async (e) => {
                  await api.patch(`/api/diners/${selected.id}`, { is_vip: e.target.checked });
                  setSelected({ ...selected, is_vip: e.target.checked });
                }} />
                VIP (extra-warm treatment from the bot)
              </label>
              <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-zinc-400">History</h3>
              {selected.reservations?.length ? (
                <div className="space-y-1.5">
                  {selected.reservations.map((r: any) => (
                    <div key={r.id} className="flex items-center justify-between rounded-lg bg-zinc-900 px-3 py-2 text-xs">
                      <span>{r.date} {String(r.time_slot).slice(0, 5)} · {r.party_size}p</span>
                      <Pill value={r.status} />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-zinc-500">No reservations yet</div>
              )}
            </Card>
          ) : (
            <Card><Empty text="Select a diner to see their profile" /></Card>
          )}
        </div>
      </div>
    </div>
  );
}

function EditRow({ label, value, onSave }: { label: string; value: string; onSave: (v: string) => Promise<void> }) {
  const [v, setV] = useState(value);
  const [saved, setSaved] = useState(false);
  useEffect(() => setV(value), [value]);
  return (
    <div className="mb-2">
      <div className="mb-1 text-xs text-zinc-500">{label}</div>
      <div className="flex gap-2">
        <Input className="flex-1" value={v} onChange={(e) => setV(e.target.value)} />
        <button
          onClick={async () => { await onSave(v); setSaved(true); setTimeout(() => setSaved(false), 1500); }}
          className="rounded-xl border border-zinc-700 px-3 text-xs text-zinc-300 hover:bg-zinc-800"
        >
          {saved ? "✓" : "Save"}
        </button>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-zinc-500">{k}</dt>
      <dd className="text-right">{v}</dd>
    </div>
  );
}
