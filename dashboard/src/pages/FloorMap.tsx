import { useEffect, useMemo, useRef, useState } from "react";
import {
  Users, Star, CalendarClock, X, Plus, Store, Clock, Ban, Trash2, Info,
} from "lucide-react";
import { api, session } from "../config/api";
import { Card, PageHeader, Empty, Btn, Input, ArmButton } from "../components/ui";
import { usePoll } from "../lib/usePoll";

const STATES = ["free", "reserved", "seated", "bill", "cleaning", "blocked"];
const CLEANING_AUTO_CLEAR_MIN = 15;

const TABLE_STYLES: Record<string, string> = {
  free: "border-emerald-500/50 bg-emerald-500/10 text-emerald-300",
  reserved: "border-amber-500/50 bg-amber-500/10 text-amber-300",
  seated: "border-sky-500/50 bg-sky-500/10 text-sky-300",
  bill: "border-purple-500/50 bg-purple-500/10 text-purple-300",
  cleaning: "border-zinc-600 bg-zinc-800/60 text-zinc-400",
  blocked: "border-red-500/50 bg-red-500/10 text-red-300",
};

// T2 sorts before T10 — string sort doesn't
function natCompare(a: string, b: string) {
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

function minsSince(ts?: string | null) {
  if (!ts) return null;
  return Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 60000));
}

export default function FloorMap() {
  const [tables, setTables] = useState<any[]>([]);
  const [casual, setCasual] = useState(false);
  const [tablesOn, setTablesOn] = useState(true);
  const [branches, setBranches] = useState<any[]>([]);
  const staffBranch = session().branch || "";
  const [branch, setBranch] = useState<string>(staffBranch || "all");
  const [nextByTable, setNextByTable] = useState<Record<string, any>>({});
  const [waitlist, setWaitlist] = useState<any[]>([]);
  const [open, setOpen] = useState<any | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const dragId = useRef<string | null>(null);
  const cleared = useRef<Set<string>>(new Set());

  useEffect(() => {
    api.get("/api/settings").then((r) => {
      setCasual(r.data?.basic_info?.restaurant_type === "casual");
      setTablesOn(r.data?.basic_info?.services?.table_numbers !== false);
      setBranches(r.data?.basic_info?.branches || []);
    }).catch(() => {});
  }, []);

  const load = () =>
    api.get("/api/tables").then((r) => {
      const rows = r.data || [];
      setTables(rows);
      // cleaning auto-clears after a while — nobody remembers to tap it back
      for (const t of rows) {
        const m = minsSince(t.updated_at);
        if (t.status === "cleaning" && m !== null && m >= CLEANING_AUTO_CLEAR_MIN && !cleared.current.has(t.id)) {
          cleared.current.add(t.id);
          api.patch(`/api/tables/${t.id}`, { status: "free" }).catch(() => {});
        }
      }
    }).catch(() => {});

  const loadBookings = () =>
    api.get("/api/reservations", { params: { date: new Date().toLocaleDateString("en-CA") } }).then((r) => {
      const now = new Date().toTimeString().slice(0, 5);
      const next: Record<string, any> = {};
      for (const res of r.data || []) {
        if (!res.table_id || !["confirmed", "reminded", "arrived"].includes(res.status)) continue;
        const t = String(res.time_slot).slice(0, 5);
        if (t < now && res.status === "confirmed") continue;
        if (!next[res.table_id] || t < String(next[res.table_id].time_slot).slice(0, 5)) next[res.table_id] = res;
      }
      setNextByTable(next);
    }).catch(() => {});

  const loadWaitlist = () =>
    api.get("/api/waitlist").then((r) => setWaitlist((r.data || []).filter((w: any) => ["waiting", "notified"].includes(w.status)))).catch(() => {});

  usePoll(() => { load(); loadBookings(); loadWaitlist(); }, 10000);

  async function setState(table: any, status: string, note?: string | null) {
    cleared.current.delete(table.id);
    setTables((ts) => ts.map((x) => (x.id === table.id ? { ...x, status, note: note ?? x.note, updated_at: new Date().toISOString() } : x)));
    const body: any = { status };
    if (note !== undefined) body.note = note;
    await api.patch(`/api/tables/${table.id}`, body).catch(() =>
      api.patch(`/api/tables/${table.id}`, { status }).catch(load)); // note column may predate migration 011
    setOpen(null);
  }

  // seats a party on a free table + records it as a real reservation row
  async function seatParty(table: any, party: number, name = "Walk-in", waitlistId?: string) {
    const now = new Date();
    await api.post("/api/reservations", {
      diner_name: name,
      diner_phone: `walkin:${now.getTime().toString(36)}`,
      party_size: party,
      date: now.toLocaleDateString("en-CA"),
      time_slot: now.toTimeString().slice(0, 5),
      status: "seated",
      source: "walk_in",
      table_id: table.id,
    }).catch(() => {});
    if (waitlistId) await api.patch(`/api/waitlist/${waitlistId}`, { status: "seated" }).catch(() => {});
    await api.patch(`/api/tables/${table.id}`, { status: "seated" }).catch(() => {});
    setOpen(null);
    load(); loadBookings(); loadWaitlist();
  }

  // drag to arrange within a section — the grid mirrors the room, not the alphabet
  async function onDrop(target: any) {
    const src = tables.find((t) => t.id === dragId.current);
    dragId.current = null;
    if (!src || !target || src.id === target.id || src.section !== target.section) return;
    const sect = visible.filter((t) => t.section === src.section);
    const without = sect.filter((t) => t.id !== src.id);
    const at = without.findIndex((t) => t.id === target.id);
    without.splice(at, 0, src);
    const updates = without.map((t, i) => ({ id: t.id, pos: i + 1 }));
    setTables((xs) => xs.map((x) => {
      const u = updates.find((u2) => u2.id === x.id);
      return u ? { ...x, pos: u.pos } : x;
    }));
    for (const u of updates) await api.patch(`/api/tables/${u.id}`, { pos: u.pos }).catch(() => {});
  }

  const visible = useMemo(() => {
    let rows = tables;
    if (branch !== "all") rows = rows.filter((t) => !t.branch || t.branch === branch);
    return [...rows].sort((a, b) =>
      (Number(a.pos) || 999) - (Number(b.pos) || 999) || natCompare(a.table_number, b.table_number));
  }, [tables, branch]);

  const sections = [...new Set(visible.map((t) => t.section))];
  const count = (s: string) => visible.filter((t) => t.status === s).length;
  const styles = casual
    ? { ...TABLE_STYLES, seated: "border-red-500/60 bg-red-500/15 text-red-300", bill: "border-red-500/60 bg-red-500/15 text-red-300", reserved: "border-red-500/60 bg-red-500/15 text-red-300" }
    : TABLE_STYLES;

  return (
    <div>
      <PageHeader
        title="Floor"
        subtitle={`${count("seated") + count("bill")}/${visible.length} occupied · ${count("reserved")} reserved · ${count("cleaning")} cleaning${count("blocked") ? ` · ${count("blocked")} blocked` : ""}`}
        actions={
          <div className="flex items-center gap-2">
            {branches.length > 1 && (
              staffBranch ? (
                <span className="flex items-center gap-1.5 rounded-full bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300">
                  <Store size={13} /> {branches.find((b: any) => b.key === staffBranch)?.name || staffBranch}
                </span>
              ) : (
                <select value={branch} onChange={(e) => setBranch(e.target.value)}
                  className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100">
                  <option value="all">All branches</option>
                  {branches.map((b: any) => (<option key={b.key} value={b.key}>{b.name}</option>))}
                </select>
              )
            )}
            <Btn onClick={() => setShowAdd(true)}><span className="flex items-center gap-1.5"><Plus size={14} /> Add table</span></Btn>
          </div>
        }
      />

      {casual && !tablesOn && (
        <div className="mb-4 flex items-center gap-2 rounded-2xl border border-zinc-700 bg-zinc-900/60 px-4 py-2.5 text-sm text-zinc-400">
          <Info size={15} className="shrink-0" /> Table numbers are switched off for this restaurant — the bot never asks for a table, so this page is a capacity view only.
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-3 text-xs">
        {Object.entries(styles).map(([status, cls]) => (
          <span key={status} className={`rounded-full border px-2.5 py-1 ${cls}`}>{status}</span>
        ))}
      </div>

      {visible.length === 0 ? (
        <Card><Empty text="No tables configured — add the first one" /></Card>
      ) : (
        sections.map((section) => (
          <div key={section} className="mb-8">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">{section}</h2>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-8">
              {visible.filter((t) => t.section === section).map((t) => {
                const m = minsSince(t.updated_at);
                const long = ["seated", "bill"].includes(t.status) && m !== null && m >= 90;
                return (
                  <button
                    key={t.id}
                    draggable
                    onDragStart={() => { dragId.current = t.id; }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => onDrop(t)}
                    onClick={() => setOpen(t)}
                    className={`relative aspect-square rounded-2xl border-2 p-2 text-center transition hover:scale-[1.03] ${long ? "ring-2 ring-amber-400" : ""} ${styles[t.status] || styles.free}`}
                  >
                    <div className="flex items-center justify-center gap-1 text-lg font-bold">
                      {t.table_number}
                      {t.vip && <Star size={12} className="fill-current" />}
                    </div>
                    <div className="flex items-center justify-center gap-1 text-[11px] opacity-80"><Users size={10} /> {t.capacity}</div>
                    <div className="mt-1 text-[10px] uppercase tracking-wide opacity-70">{t.status}</div>
                    {["seated", "bill", "cleaning"].includes(t.status) && m !== null && (
                      <div className={`flex items-center justify-center gap-0.5 text-[10px] ${long ? "font-bold text-amber-300" : "opacity-60"}`}>
                        <Clock size={9} /> {m}m
                      </div>
                    )}
                    {t.status === "blocked" && t.note && (
                      <div className="truncate text-[9px] opacity-70" title={t.note}>{t.note}</div>
                    )}
                    {nextByTable[t.id] && (
                      <div className="mt-0.5 flex items-center justify-center gap-0.5 truncate text-[10px] text-amber-300"
                        title={`${nextByTable[t.id].diner_display || nextByTable[t.id].diner_phone} — ${nextByTable[t.id].code}`}>
                        <CalendarClock size={9} /> {String(nextByTable[t.id].time_slot).slice(0, 5)} ×{nextByTable[t.id].party_size}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))
      )}

      {open && (
        <TablePanel
          table={tables.find((t) => t.id === open.id) || open}
          reservation={nextByTable[open.id]}
          waitlist={waitlist}
          branches={branches}
          onClose={() => setOpen(null)}
          onState={setState}
          onSeat={seatParty}
          onSaved={() => { setOpen(null); load(); }}
        />
      )}
      {showAdd && (
        <AddTableModal sections={[...new Set(tables.map((t) => t.section))]} branches={branches}
          onClose={() => setShowAdd(false)} onCreated={() => { setShowAdd(false); load(); }} />
      )}
    </div>
  );
}

// Tap opens a panel — who's here, what to do next. No blind state cycling.
function TablePanel({ table, reservation, waitlist, branches, onClose, onState, onSeat, onSaved }: any) {
  const [blocking, setBlocking] = useState(false);
  const [note, setNote] = useState(table.note || "");
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({ table_number: table.table_number, section: table.section, capacity: String(table.capacity), branch: table.branch || "", vip: !!table.vip });
  const m = minsSince(table.updated_at);
  const nextParty = waitlist
    .filter((w: any) => Number(w.party_size || 0) <= Number(table.capacity))
    .sort((a: any, b: any) => String(a.created_at).localeCompare(String(b.created_at)))[0];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-950 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <div className="flex items-center gap-2 text-base font-bold">
            {table.table_number}
            {table.vip && <Star size={13} className="fill-amber-400 text-amber-400" />}
            <span className="text-xs font-normal text-zinc-500">{table.section} · {table.capacity} seats{table.branch ? ` · ${table.branch}` : ""}</span>
          </div>
          <button onClick={onClose}><X size={16} className="text-zinc-500 hover:text-zinc-200" /></button>
        </div>
        <div className="mb-3 text-xs text-zinc-500">
          {table.status.toUpperCase()}{m !== null && ["seated", "bill", "cleaning"].includes(table.status) ? ` for ${m} min` : ""}
          {table.status === "cleaning" ? ` — auto-clears at ${CLEANING_AUTO_CLEAR_MIN} min` : ""}
          {table.note ? ` · ${table.note}` : ""}
        </div>

        {reservation && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-zinc-200">
            <CalendarClock size={13} className="text-amber-400" />
            Reserved {String(reservation.time_slot).slice(0, 5)} — {reservation.diner_display || reservation.diner_phone} ×{reservation.party_size}
          </div>
        )}

        {table.status === "free" && (
          <div className="mb-3 space-y-2">
            <button onClick={() => { const p = Number(prompt(`Party size for ${table.table_number}?`, "2")); if (p >= 1) onSeat(table, p); }}
              className="w-full rounded-xl bg-zinc-100 px-3 py-2 text-sm font-semibold text-zinc-900">
              Seat a walk-in
            </button>
            {nextParty && (
              <button onClick={() => onSeat(table, Number(nextParty.party_size) || 2, nextParty.diner_name || nextParty.name || "Waitlist", nextParty.id)}
                className="w-full rounded-xl border border-emerald-500/50 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
                Seat from waitlist: {nextParty.diner_name || nextParty.name || "party"} ×{nextParty.party_size} ({minsSince(nextParty.created_at)}m waiting)
              </button>
            )}
          </div>
        )}

        <div className="mb-3 grid grid-cols-3 gap-1.5">
          {STATES.filter((s) => s !== "blocked").map((s) => (
            <button key={s} onClick={() => onState(table, s)}
              className={`rounded-lg border px-2 py-1.5 text-xs capitalize ${table.status === s ? "border-zinc-400 bg-zinc-200 font-semibold text-zinc-900" : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"}`}>
              {s}
            </button>
          ))}
          <button onClick={() => setBlocking(!blocking)}
            className={`flex items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-xs ${table.status === "blocked" ? "border-red-400 bg-red-500/20 font-semibold text-red-300" : "border-red-500/40 text-red-400 hover:bg-red-500/10"}`}>
            <Ban size={11} /> block
          </button>
        </div>
        {blocking && (
          <div className="mb-3 flex gap-2">
            <Input className="flex-1" placeholder="Why? (broken chair, staff hold…)" value={note} onChange={(e: any) => setNote(e.target.value)} />
            <Btn className="px-3 py-1.5 text-xs" onClick={() => onState(table, "blocked", note.trim() || null)}>Block</Btn>
          </div>
        )}

        <button onClick={() => setEditing(!editing)} className="text-[11px] text-zinc-500 underline decoration-dotted hover:text-zinc-300">
          {editing ? "hide table settings" : "edit table settings"}
        </button>
        {editing && (
          <div className="mt-2 space-y-2 rounded-xl border border-zinc-800 p-3">
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="Number" value={f.table_number} onChange={(e: any) => setF({ ...f, table_number: e.target.value })} />
              <Input placeholder="Section" value={f.section} onChange={(e: any) => setF({ ...f, section: e.target.value })} />
              <Input type="number" placeholder="Seats" value={f.capacity} onChange={(e: any) => setF({ ...f, capacity: e.target.value })} />
              <select value={f.branch} onChange={(e) => setF({ ...f, branch: e.target.value })}
                className="rounded-xl border border-zinc-700 bg-zinc-900 px-2 py-2 text-xs text-zinc-200">
                <option value="">All branches</option>
                {branches.map((b: any) => (<option key={b.key} value={b.key}>{b.name}</option>))}
              </select>
            </div>
            <label className="flex items-center gap-1.5 text-xs text-zinc-300">
              <input type="checkbox" checked={f.vip} onChange={(e) => setF({ ...f, vip: e.target.checked })} /> VIP table
            </label>
            <div className="flex justify-between">
              <ArmButton armedLabel={`Delete ${table.table_number}?`} onConfirm={async () => {
                await api.delete(`/api/tables/${table.id}`).catch(() => {});
                onSaved();
              }} className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300"><Trash2 size={12} /> delete</ArmButton>
              <Btn className="px-3 py-1.5 text-xs" onClick={async () => {
                await api.patch(`/api/tables/${table.id}`, {
                  table_number: f.table_number.trim(), section: f.section.trim(),
                  capacity: Number(f.capacity) || 2, branch: f.branch || null, vip: f.vip,
                }).catch(() => {});
                onSaved();
              }}>Save</Btn>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AddTableModal({ sections, branches, onClose, onCreated }: any) {
  const [f, setF] = useState({ table_number: "", section: sections[0] || "Indoor", capacity: "4", branch: "", vip: false });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-950 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold">Add table</div>
          <button onClick={onClose}><X size={16} className="text-zinc-500 hover:text-zinc-200" /></button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input placeholder="Number (T11)" value={f.table_number} onChange={(e: any) => setF({ ...f, table_number: e.target.value })} />
          <div>
            <Input list="fl-sections" placeholder="Section" value={f.section} onChange={(e: any) => setF({ ...f, section: e.target.value })} />
            <datalist id="fl-sections">{sections.map((s: string) => <option key={s} value={s} />)}</datalist>
          </div>
          <Input type="number" placeholder="Seats" value={f.capacity} onChange={(e: any) => setF({ ...f, capacity: e.target.value })} />
          <select value={f.branch} onChange={(e) => setF({ ...f, branch: e.target.value })}
            className="rounded-xl border border-zinc-700 bg-zinc-900 px-2 py-2 text-xs text-zinc-200">
            <option value="">All branches</option>
            {branches.map((b: any) => (<option key={b.key} value={b.key}>{b.name}</option>))}
          </select>
        </div>
        <label className="mt-2 flex items-center gap-1.5 text-xs text-zinc-300">
          <input type="checkbox" checked={f.vip} onChange={(e) => setF({ ...f, vip: e.target.checked })} /> VIP table
        </label>
        <div className="mt-3 flex justify-end">
          <Btn onClick={async () => {
            if (!f.table_number.trim()) return;
            await api.post("/api/tables", {
              table_number: f.table_number.trim(), section: f.section.trim() || "Indoor",
              capacity: Number(f.capacity) || 4, branch: f.branch || null, vip: f.vip,
            }).catch((e: any) => alert(e.response?.data?.error || "Failed"));
            onCreated();
          }}>Add table</Btn>
        </div>
      </div>
    </div>
  );
}
