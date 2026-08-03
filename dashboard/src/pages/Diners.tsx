import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search, Star, MessageCircle, Download, Megaphone, AlertCircle, MapPin,
  Ticket, X, Cake, Store, Clock,
} from "lucide-react";
import { api } from "../config/api";
import { Card, PageHeader, Pill, Input, Empty } from "../components/ui";

// money never reads "478.8" — whole numbers stay whole, fractions get two places
function money(n: any) {
  const v = Number(n || 0);
  return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function relTime(ts?: string | null): string {
  if (!ts) return "never";
  const s = (Date.now() - new Date(ts).getTime()) / 1000;
  if (s < 3600) return "today";
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function daysSince(ts?: string | null): number {
  if (!ts) return Infinity;
  return (Date.now() - new Date(ts).getTime()) / 86400000;
}

// lifecycle is computed from behaviour, not typed by hand
function lifecycle(d: any): { label: string; cls: string } {
  const idle = daysSince(d.last_visit_at || d.last_seen_at);
  if ((d.visit_count || 0) >= 2 && idle > 30) return { label: "win-back", cls: "bg-red-500/15 text-red-300" };
  if ((d.visit_count || 0) === 0) return { label: "lead", cls: "bg-zinc-800 text-zinc-300" };
  if ((d.visit_count || 0) === 1) return { label: "new", cls: "bg-sky-500/15 text-sky-300" };
  if ((d.visit_count || 0) < 5) return { label: "returning", cls: "bg-emerald-500/15 text-emerald-300" };
  return { label: "regular", cls: "bg-amber-500/15 text-amber-300" };
}

const SEGMENTS = [
  { key: "all", label: "All" },
  { key: "new", label: "New" },
  { key: "returning", label: "Returning" },
  { key: "regular", label: "Regular" },
  { key: "vip", label: "VIP" },
  { key: "winback", label: "Win-back (30d+)" },
];

function daysUntilMMDD(mmdd?: string | null): number | null {
  if (!mmdd || !/^\d{2}-\d{2}$/.test(mmdd)) return null;
  const [m, d] = mmdd.split("-").map(Number);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(now.getFullYear(), m - 1, d);
  if (next < today) next = new Date(now.getFullYear() + 1, m - 1, d);
  return Math.round((next.getTime() - today.getTime()) / 86400000);
}

export default function Diners() {
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [seg, setSeg] = useState("all");
  const [sort, setSort] = useState<"seen" | "spend" | "visits">("seen");
  const [selected, setSelected] = useState<any | null>(null);
  const nav = useNavigate();

  const load = () => api.get("/api/diners", { params: { q } }).then((r) => setRows(r.data)).catch(() => {});
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [q]);

  async function open(id: string) {
    const { data } = await api.get(`/api/diners/${id}`);
    setSelected(data);
  }

  async function toggleVip(d: any) {
    await api.patch(`/api/diners/${d.id}`, { is_vip: !d.is_vip }).catch(() => {});
    setRows((xs) => xs.map((x) => (x.id === d.id ? { ...x, is_vip: !d.is_vip } : x)));
    if (selected?.id === d.id) setSelected({ ...selected, is_vip: !d.is_vip });
  }

  const filtered = useMemo(() => {
    let out = rows.filter((d) => {
      if (seg === "vip") return d.is_vip;
      if (seg === "all") return true;
      const l = lifecycle(d).label;
      if (seg === "winback") return l === "win-back";
      return l === seg;
    });
    out = [...out].sort((a, b) =>
      sort === "spend" ? Number(b.total_spend || 0) - Number(a.total_spend || 0)
      : sort === "visits" ? Number(b.visit_count || 0) - Number(a.visit_count || 0)
      : String(b.last_seen_at || "").localeCompare(String(a.last_seen_at || "")));
    return out;
  }, [rows, seg, sort]);

  function exportCsv() {
    const head = ["name", "phone", "visits", "total_spend", "last_seen", "lifecycle", "vip", "allergies", "tags"];
    const lines = [head.join(",")].concat(filtered.map((d) => [
      JSON.stringify(d.name || d.wa_profile_name || ""), d.phone_number, d.visit_count, d.total_spend,
      d.last_seen_at || "", lifecycle(d).label, d.is_vip ? "yes" : "", JSON.stringify((d.allergies || []).join("; ")), JSON.stringify((d.tags || []).join("; ")),
    ].join(",")));
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `diners-${seg}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  return (
    <div>
      <PageHeader
        title="Diners"
        subtitle="Your guest CRM — the bot remembers all of this"
        actions={
          <div className="flex items-center gap-2">
            <button onClick={exportCsv} title="Export this view as CSV"
              className="rounded-xl border border-zinc-700 p-2.5 text-zinc-300 hover:bg-zinc-800"><Download size={15} /></button>
            <button disabled title="Send an offer to this segment — available once WhatsApp templates are approved by Meta"
              className="flex cursor-not-allowed items-center gap-1.5 rounded-xl border border-zinc-800 px-3 py-2 text-xs text-zinc-600">
              <Megaphone size={13} /> Broadcast
            </button>
            <div className="relative">
              <Search size={15} className="absolute left-3 top-2.5 text-zinc-500" />
              <Input placeholder="Search name, phone, tag…" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {SEGMENTS.map((s) => (
          <button key={s.key} onClick={() => setSeg(s.key)}
            className={`rounded-full px-3 py-1 text-xs transition ${seg === s.key ? "bg-zinc-200 font-semibold text-zinc-900" : "bg-zinc-800/70 text-zinc-400 hover:text-zinc-200"}`}>
            {s.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1 text-xs text-zinc-500">
          sort
          <select value={sort} onChange={(e) => setSort(e.target.value as any)}
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-200">
            <option value="seen">last seen</option>
            <option value="spend">spend</option>
            <option value="visits">visits</option>
          </select>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <div className="space-y-2 lg:col-span-3">
          {filtered.length === 0 ? (
            <Card><Empty text="No diners in this view" /></Card>
          ) : (
            filtered.map((d) => {
              const lc = lifecycle(d);
              return (
                <Card
                  key={d.id}
                  className={`cursor-pointer px-4 py-3 transition hover:border-zinc-600 ${selected?.id === d.id ? "border-amber-500/60" : ""}`}
                >
                  <div onClick={() => open(d.id)} className="flex items-center gap-3">
                    <div
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold"
                      style={{ backgroundColor: "color-mix(in srgb, var(--accent) 20%, transparent)", color: "var(--accent)" }}
                    >
                      {(d.name || d.wa_profile_name || "#").charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        {d.name || d.wa_profile_name || d.phone_number}
                        {d.allergies?.length > 0 && <span title={`Allergies: ${d.allergies.join(", ")}`}><AlertCircle size={12} className="text-red-400" /></span>}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 text-xs text-zinc-500">
                        <span>{d.phone_number}</span>
                        <span>· {d.visit_count} visit{Number(d.visit_count) === 1 ? "" : "s"}</span>
                        <span>· EGP {money(d.total_spend)}</span>
                        <span className="flex items-center gap-0.5">· <Clock size={10} /> {relTime(d.last_seen_at)}</span>
                        {d.preferred_branch && <span className="flex items-center gap-0.5">· <Store size={10} /> {d.preferred_branch}</span>}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {(d.tags || []).slice(0, 2).map((t: string) => (
                        <span key={t} className="rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-300">{t}</span>
                      ))}
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${lc.cls}`}>{lc.label}</span>
                      <button
                        title={d.is_vip ? "Remove VIP" : "Make VIP"}
                        onClick={(e) => { e.stopPropagation(); toggleVip(d); }}
                        className="p-1"
                      >
                        <Star size={15} className={d.is_vip ? "fill-fuchsia-400 text-fuchsia-400" : "text-zinc-600 hover:text-zinc-400"} />
                      </button>
                    </div>
                  </div>
                </Card>
              );
            })
          )}
        </div>

        <div className="lg:col-span-2">
          {selected ? (
            <DinerDetail selected={selected} setSelected={setSelected} toggleVip={toggleVip} nav={nav} />
          ) : (
            <Card><Empty text="Select a diner to see their profile" /></Card>
          )}
        </div>
      </div>
    </div>
  );
}

function DinerDetail({ selected, setSelected, toggleVip, nav }: any) {
  const bdays = daysUntilMMDD(selected.preferences?.occasions?.birthday);
  return (
    <Card className="sticky top-0 max-h-[85vh] overflow-y-auto p-5">
      <div className="mb-1 flex items-center gap-2 text-lg font-semibold">
        {selected.name || selected.wa_profile_name || selected.phone_number}
        {selected.is_vip && <Star size={15} className="fill-fuchsia-400 text-fuchsia-400" />}
      </div>
      <div className="mb-3 text-sm text-zinc-500">{selected.phone_number}</div>

      {/* actions — a CRM you can't act from is a spreadsheet */}
      <div className="mb-4 flex flex-wrap gap-2">
        <button onClick={() => nav(`/chats?session=${encodeURIComponent(selected.phone_number)}`)}
          className="flex items-center gap-1.5 rounded-xl bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-900">
          <MessageCircle size={13} /> Open chat
        </button>
        <button onClick={() => toggleVip(selected)}
          className="flex items-center gap-1.5 rounded-xl border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800">
          <Star size={13} className={selected.is_vip ? "fill-fuchsia-400 text-fuchsia-400" : ""} /> {selected.is_vip ? "VIP" : "Make VIP"}
        </button>
        <button disabled title="Available once WhatsApp templates are approved by Meta"
          className="flex cursor-not-allowed items-center gap-1.5 rounded-xl border border-zinc-800 px-3 py-1.5 text-xs text-zinc-600">
          <Megaphone size={13} /> Send offer
        </button>
      </div>

      {selected.allergies?.length > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-2 text-xs font-semibold text-zinc-100">
          <AlertCircle size={14} className="text-red-400" /> Allergies: {selected.allergies.join(", ")}
        </div>
      )}
      {bdays !== null && bdays <= 30 && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-fuchsia-500/40 bg-fuchsia-500/10 px-3 py-2 text-xs text-zinc-200">
          <Cake size={14} className="text-fuchsia-300" /> Birthday {bdays === 0 ? "TODAY" : `in ${bdays} days`}
        </div>
      )}

      {/* the numbers that matter, at a glance */}
      <div className="mb-4 grid grid-cols-3 gap-2 text-center">
        <Stat label="visits" value={String(selected.visit_count)} />
        <Stat label="lifetime EGP" value={money(selected.total_spend)} />
        <Stat label="avg ticket" value={selected.stats?.avg_ticket ? money(selected.stats.avg_ticket) : "—"} />
      </div>
      <div className="mb-4 space-y-1 text-xs text-zinc-400">
        {selected.stats?.last_order_at && <div className="flex items-center gap-1.5"><Clock size={11} /> Last order {relTime(selected.stats.last_order_at)} ago</div>}
        {selected.stats?.favorite_branch && <div className="flex items-center gap-1.5"><Store size={11} /> Favorite branch: {selected.stats.favorite_branch}</div>}
        {selected.preferences?.addresses?.length > 0 && selected.preferences.addresses.map((a: any, i: number) => (
          <div key={i} className="flex items-start gap-1.5"><MapPin size={11} className="mt-0.5 shrink-0" /> {a.text}</div>
        ))}
      </div>

      {/* what the bot remembers, as removable chips */}
      <MemoryChips selected={selected} setSelected={setSelected} field="favorite_items" title="Favorite dishes" />
      <MemoryChips selected={selected} setSelected={setSelected} field="facts" title="Known about them" />
      <MemoryChips selected={selected} setSelected={setSelected} field="ai_notes" title="AI observations" />
      <TagChips selected={selected} setSelected={setSelected} />

      <EditForm selected={selected} setSelected={setSelected} />

      {selected.orders?.length > 0 && (
        <>
          <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-zinc-400">Orders ({selected.orders.length})</h3>
          <div className="space-y-1.5">
            {selected.orders.map((o: any) => (
              <div key={o.id} className="rounded-lg bg-zinc-900 px-3 py-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 font-mono font-semibold text-zinc-200"><Ticket size={11} /> {o.code}</span>
                  <span className={o.status === "cancelled" ? "text-red-400" : "text-zinc-400"}>{o.status}</span>
                </div>
                <div className="mt-0.5 flex items-center justify-between text-zinc-500">
                  <span className="truncate pr-2">{o.items}</span>
                  <span className="shrink-0 tabular-nums text-zinc-300">EGP {money(o.total)}</span>
                </div>
                <div className="text-[10px] text-zinc-600">{String(o.order_type || "").replace("_", "-")}{o.branch ? ` · ${o.branch}` : ""} · {new Date(o.created_at).toLocaleDateString()}</div>
              </div>
            ))}
          </div>
        </>
      )}

      <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-zinc-400">Reservations</h3>
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
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-zinc-900 px-2 py-2">
      <div className="text-base font-bold tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
    </div>
  );
}

// bot memory rendered as chips — delete a wrong one with a tap
function MemoryChips({ selected, setSelected, field, title }: any) {
  const items: string[] = selected.preferences?.[field] || [];
  if (!items.length) return null;
  async function remove(item: string) {
    const next = items.filter((x) => x !== item);
    const preferences = { ...(selected.preferences || {}), [field]: next };
    await api.patch(`/api/diners/${selected.id}`, { preferences }).catch(() => {});
    setSelected({ ...selected, preferences });
  }
  return (
    <div className="mb-3">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">{title}</div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((it) => (
          <span key={it} className="flex items-center gap-1 rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-200">
            {it}
            <button onClick={() => remove(it)} className="text-zinc-500 hover:text-red-400" title="Forget this"><X size={10} /></button>
          </span>
        ))}
      </div>
    </div>
  );
}

function TagChips({ selected, setSelected }: any) {
  const [adding, setAdding] = useState("");
  const tags: string[] = selected.tags || [];
  async function save(next: string[]) {
    await api.patch(`/api/diners/${selected.id}`, { tags: next }).catch(() => {});
    setSelected({ ...selected, tags: next });
  }
  return (
    <div className="mb-3">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">Tags</div>
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((t) => (
          <span key={t} className="flex items-center gap-1 rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-200">
            {t}
            <button onClick={() => save(tags.filter((x) => x !== t))} className="text-zinc-500 hover:text-red-400"><X size={10} /></button>
          </span>
        ))}
        <input
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && adding.trim()) { save([...tags, adding.trim()]); setAdding(""); } }}
          placeholder="+ tag"
          className="w-16 rounded-full border border-zinc-800 bg-transparent px-2 py-0.5 text-[11px] text-zinc-300 outline-none focus:border-zinc-600"
        />
      </div>
    </div>
  );
}

// ONE form, ONE save — lights up only when something changed
function EditForm({ selected, setSelected }: any) {
  const initial = {
    allergies: (selected.allergies || []).join(", "),
    notes: selected.notes || "",
    seating: selected.preferences?.seating || "",
    birthday: selected.preferences?.occasions?.birthday || "",
    anniversary: selected.preferences?.occasions?.anniversary || "",
  };
  const [form, setForm] = useState(initial);
  const [saved, setSaved] = useState(false);
  useEffect(() => { setForm(initial); }, [selected.id]);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  async function saveAll() {
    const allergies = form.allergies.split(",").map((x: string) => x.trim().toLowerCase()).filter(Boolean);
    const preferences = {
      ...(selected.preferences || {}),
      seating: form.seating.trim().toLowerCase() || undefined,
      occasions: {
        ...(selected.preferences?.occasions || {}),
        birthday: form.birthday.trim() || undefined,
        anniversary: form.anniversary.trim() || undefined,
      },
    };
    await api.patch(`/api/diners/${selected.id}`, { allergies, notes: form.notes, preferences }).catch(() => {});
    setSelected({ ...selected, allergies, notes: form.notes, preferences });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  // plain function, not a component — a component defined in-render remounts
  // its input on every keystroke and the field loses focus
  const field = (label: string, k: keyof typeof form, placeholder?: string) => (
    <div className="mb-2">
      <div className="mb-1 text-xs text-zinc-500">{label}</div>
      <Input value={form[k]} placeholder={placeholder} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
    </div>
  );

  return (
    <div className="mt-4 rounded-xl border border-zinc-800 p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Edit (the bot uses these)</h3>
      {field("Allergies (comma-sep)", "allergies")}
      {field("Notes", "notes")}
      {field("Seating preference", "seating", "indoor / outdoor / terrace / quiet / window / bar")}
      <div className="grid grid-cols-2 gap-2">
        {field("Birthday (MM-DD)", "birthday")}
        {field("Anniversary (MM-DD)", "anniversary")}
      </div>
      <button
        onClick={saveAll}
        disabled={!dirty && !saved}
        className={`mt-1 rounded-xl px-4 py-1.5 text-xs font-semibold transition ${
          saved ? "bg-emerald-500/20 text-emerald-300" : dirty ? "bg-zinc-100 text-zinc-900" : "cursor-default border border-zinc-800 text-zinc-600"
        }`}
      >
        {saved ? "Saved" : dirty ? "Save changes" : "No changes"}
      </button>
    </div>
  );
}
