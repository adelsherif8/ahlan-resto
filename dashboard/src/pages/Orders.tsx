import { useEffect, useMemo, useRef, useState } from "react";
import {
  Inbox, Flame, CheckCircle2, Flag, Utensils, ShoppingBag, Clock, Bike, Receipt,
  Bell, BellOff, Monitor, Printer, Phone, MapPin, Store, X, AlertTriangle,
  Plus, Search, MessageCircle, Minus,
} from "lucide-react";
import { api, session } from "../config/api";
import { PageHeader, Btn } from "../components/ui";

// Fast-food ticket board (KDS): tickets flow left → right, one tap advances.
const COLS: { key: string; label: string; Icon: any; statuses: string[]; next?: string; nextLabel?: string }[] = [
  { key: "new", label: "New", Icon: Inbox, statuses: ["pending", "accepted"], next: "preparing", nextLabel: "Start" },
  { key: "preparing", label: "On the grill", Icon: Flame, statuses: ["preparing"], next: "ready", nextLabel: "Ready" },
  { key: "ready", label: "Ready", Icon: CheckCircle2, statuses: ["ready"], next: "served", nextLabel: "Handed over" },
  { key: "road", label: "On the road", Icon: Bike, statuses: ["out_for_delivery"], next: "delivered", nextLabel: "Delivered" },
  { key: "done", label: "Done", Icon: Flag, statuses: ["served", "delivered", "paid"] },
];

// delivery tickets take the courier detour: Ready → out the door → delivered
const nextFor = (o: any, col: any) =>
  col.key === "ready" && o.order_type === "delivery"
    ? { next: "out_for_delivery", label: "Send out" }
    : col.next ? { next: col.next, label: col.nextLabel } : null;

const TYPE: Record<string, { label: string; Icon: any; bar: string; chip: string }> = {
  dine_in:       { label: "DINE IN",   Icon: Utensils,    bar: "bg-sky-500",     chip: "bg-sky-100 text-sky-800" },
  table_reorder: { label: "DINE IN",   Icon: Utensils,    bar: "bg-sky-500",     chip: "bg-sky-100 text-sky-800" },
  pickup:        { label: "TAKEAWAY",  Icon: ShoppingBag, bar: "bg-amber-500",   chip: "bg-amber-100 text-amber-800" },
  pre_order:     { label: "PRE-ORDER", Icon: Clock,       bar: "bg-emerald-500", chip: "bg-emerald-100 text-emerald-800" },
  delivery:      { label: "DELIVERY",  Icon: Bike,        bar: "bg-rose-500",    chip: "bg-rose-100 text-rose-800" },
};
const typeOf = (t: string) => TYPE[t] || { label: (t || "order").toUpperCase(), Icon: Receipt, bar: "bg-neutral-500", chip: "bg-neutral-200 text-neutral-700" };

const TEAR = {
  backgroundImage: "linear-gradient(-45deg, transparent 70%, #fbfaf4 71%), linear-gradient(45deg, transparent 70%, #fbfaf4 71%)",
  backgroundSize: "12px 8px",
  backgroundRepeat: "repeat-x",
} as const;

const CANCEL_REASONS = ["Guest cancelled", "Out of stock", "Entered by mistake"];

function mins(since: string) {
  return Math.max(0, Math.round((Date.now() - new Date(since).getTime()) / 60000));
}

function money(n: any) {
  const v = Number(n || 0);
  return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const KEY_ORDER = ["format", "size", "side", "drink"];
function modLines(i: any): string[] {
  const entries = Object.entries(i.options || {}).filter(([k]) => k !== "slots");
  entries.sort(([a], [b]) => {
    const ia = KEY_ORDER.indexOf(a), ib = KEY_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  const out = entries.map(([, v]) => (Array.isArray(v) ? v.join(", ") : String(v)));
  const slots = (i.options || {}).slots;
  if (Array.isArray(slots)) {
    slots.forEach((sl: any, si: number) => {
      const vals = Object.entries(sl || {}).filter(([f]) => f !== "notes").map(([, x]) => x).join(" + ");
      out.push(`${si + 1}) ${vals}${sl?.notes ? ` — ${sl.notes}` : ""}`);
    });
  }
  if (i.notes) out.push(`* ${i.notes}`);
  return out;
}

function ding() {
  try {
    const ac = new (window.AudioContext || (window as any).webkitAudioContext)();
    [0, 0.18].forEach((t) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.connect(g); g.connect(ac.destination);
      o.frequency.value = 880; g.gain.setValueAtTime(0.15, ac.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + t + 0.15);
      o.start(ac.currentTime + t); o.stop(ac.currentTime + t + 0.16);
    });
  } catch { /* audio blocked until first interaction — fine */ }
}

function printTicket(o: any, branchName: string) {
  const t = typeOf(o.order_type);
  const rows = (o.items || []).map((i: any) =>
    `<div class="r"><b>${i.qty}x ${i.name}</b><span>${money(Number(i.unit_price ?? i.price) * Number(i.qty))}</span></div>` +
    modLines(i).map((m) => `<div class="m">&raquo; ${m}</div>`).join("")
  ).join("");
  const w = window.open("", "_blank", "width=330,height=640");
  if (!w) return;
  w.document.write(`<html><head><title>${o.code}</title><style>
    body{font-family:ui-monospace,Menlo,monospace;width:280px;margin:8px auto;color:#000}
    .c{text-align:center}.big{font-size:30px;font-weight:800;letter-spacing:3px}
    .r{display:flex;justify-content:space-between;margin:2px 0}.m{color:#444;font-size:11px;padding-left:12px}
    hr{border:none;border-top:1px dashed #888;margin:6px 0}
  </style></head><body>
    <div class="c"><b>${t.label}${o.table_number ? " · T" + o.table_number : ""}</b></div>
    <div class="c big">${o.code}</div>
    <div class="c">${o.diner_name || o.phone_number || "guest"}${branchName ? " · " + branchName : ""}</div>
    <hr>${rows}<hr>
    <div class="r"><b>TOTAL</b><b>EGP ${money(o.total)}</b></div>
    ${o.payment_method ? `<div>PAYMENT: ${String(o.payment_method).toUpperCase()}</div>` : ""}
    ${o.address ? `<div>DELIVER TO: ${o.address}</div>` : ""}
    ${o.notes ? `<div>!! ${o.notes}</div>` : ""}
  </body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); w.close(); }, 250);
}

export default function Orders() {
  const [rows, setRows] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [waNumber, setWaNumber] = useState("");
  const staffBranch = session().branch || "";
  const [branch, setBranch] = useState<string>(staffBranch || localStorage.getItem("resto_branch_view") || "all");
  const [sound, setSound] = useState(localStorage.getItem("kds_sound") !== "off");
  const [undo, setUndo] = useState<{ order: any; prev: string } | null>(null);
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const [tv, setTv] = useState(false);
  const [date, setDate] = useState(new Date().toLocaleDateString("en-CA"));
  const [showCancelled, setShowCancelled] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<any | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [findCode, setFindCode] = useState("");
  const [syncedAt, setSyncedAt] = useState<number>(Date.now());
  const knownIds = useRef<Set<string> | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const undoTimer = useRef<any>(null);

  const today = new Date().toLocaleDateString("en-CA");
  const isToday = date === today;

  const load = (b = branch) =>
    api.get("/api/orders", { params: { branch: b } }).then((r) => { setRows(r.data); setSyncedAt(Date.now()); }).catch(() => {});
  useEffect(() => {
    api.get("/api/settings").then((r) => {
      setBranches(r.data?.basic_info?.branches || []);
      setWaNumber(r.data?.basic_info?.contact?.whatsapp || r.data?.basic_info?.contact?.phone || "");
    }).catch(() => {});
  }, []);
  useEffect(() => {
    load(branch);
    if (!staffBranch) localStorage.setItem("resto_branch_view", branch);
    const t = setInterval(() => load(branch), 5000);
    return () => clearInterval(t);
  }, [branch]);

  useEffect(() => {
    const f = () => setTv(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", f);
    return () => document.removeEventListener("fullscreenchange", f);
  }, []);

  const dayRows = useMemo(
    () => rows.filter((o) => String(o.created_at).slice(0, 10) === date),
    [rows, date]
  );
  const visible = dayRows.filter((o) => o.status !== "cancelled");
  const cancelled = dayRows.filter((o) => o.status === "cancelled");
  const DONE = ["served", "delivered", "paid"];
  const active = isToday ? visible.filter((o) => !DONE.includes(o.status)) : [];
  const fresh = isToday ? visible.filter((o) => COLS[0].statuses.includes(o.status)) : [];

  // new-ticket ding + flash + tab badge (today only; skip the very first load)
  useEffect(() => {
    if (!isToday) return;
    const ids = new Set<string>(fresh.map((o) => String(o.id)));
    if (knownIds.current) {
      const newcomers = [...ids].filter((id) => !knownIds.current!.has(id));
      if (newcomers.length) {
        if (sound) ding();
        setFlash((f) => new Set([...f, ...newcomers]));
        setTimeout(() => setFlash((f) => { const n = new Set(f); newcomers.forEach((id) => n.delete(id)); return n; }), 6000);
      }
    }
    knownIds.current = ids;
    document.title = `${fresh.length ? `(${fresh.length}) ` : ""}Orders`;
    return () => { document.title = "Orders"; };
  }, [rows.map((o) => o.id).join(","), sound, isToday]);

  async function advance(o: any, status: string, withUndo = true, reason?: string) {
    if (withUndo) {
      clearTimeout(undoTimer.current);
      setUndo({ order: o, prev: o.status });
      undoTimer.current = setTimeout(() => setUndo(null), 5000);
    }
    setRows((xs) => xs.map((x) => (x.id === o.id ? { ...x, status, cancel_reason: reason || x.cancel_reason } : x)));
    await api.patch(`/api/orders/${o.id}`, { status, ...(reason ? { cancel_reason: reason } : {}) }).catch(load);
  }

  // digest numbers — real prep time when the stamps exist, updated_at as fallback
  const done = visible.filter((o) => DONE.includes(o.status));
  const prepTimes = done
    .map((o) => {
      const end = o.ready_at || o.served_at || o.updated_at;
      return end ? (new Date(end).getTime() - new Date(o.created_at).getTime()) / 60000 : null;
    })
    .filter((x): x is number => x !== null && x > 0 && x < 240);
  const avgPrep = prepTimes.length ? Math.round(prepTimes.reduce((s, x) => s + x, 0) / prepTimes.length) : null;
  const lateCount = active.filter((o) => mins(o.created_at) > 20).length;

  const sortCol = (list: any[], colKey: string) =>
    colKey !== "new" ? list : [...list].sort((a, b) =>
      (a.order_type === "pre_order" ? 1 : 0) - (b.order_type === "pre_order" ? 1 : 0) ||
      String(a.created_at).localeCompare(String(b.created_at)));

  const matchCode = (o: any) => findCode.trim() && String(o.code || "").toLowerCase().includes(findCode.trim().toLowerCase());
  useEffect(() => {
    if (!findCode.trim()) return;
    const hit = dayRows.find(matchCode);
    if (hit) document.getElementById(`tk-${hit.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [findCode]);

  const boardEmpty = visible.length === 0;

  return (
    <div className="flex h-full flex-col">
      {!tv && (
        <PageHeader
          title="Orders"
          subtitle={`${isToday ? `${active.length} live · ` : ""}${visible.length} on ${isToday ? "today" : date} · EGP ${money(visible.reduce((s, o) => s + Number(o.total || 0), 0))}${avgPrep ? ` · avg ${avgPrep} min` : ""}${lateCount ? ` · ${lateCount} late` : ""}${cancelled.length ? ` · ` : ""}`}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input value={findCode} onChange={(e) => setFindCode(e.target.value)} placeholder="O-CODE"
                  className="w-24 rounded-xl border border-zinc-700 bg-zinc-900 py-2 pl-8 pr-2 text-xs uppercase text-zinc-100 outline-none focus:border-zinc-500" />
              </div>
              <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value || today)}
                className="rounded-xl border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200" />
              <button title={sound ? "Sound on" : "Sound off"}
                onClick={() => { const n = !sound; setSound(n); localStorage.setItem("kds_sound", n ? "on" : "off"); if (n) ding(); }}
                className="rounded-xl border border-zinc-700 p-2.5 text-zinc-300"
              >{sound ? <Bell size={15} /> : <BellOff size={15} />}</button>
              <button title="Kitchen TV mode — fullscreen board"
                onClick={() => boardRef.current?.requestFullscreen?.().catch(() => {})}
                className="rounded-xl border border-zinc-700 p-2.5 text-zinc-300"
              ><Monitor size={15} /></button>
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
              <Btn onClick={() => setShowNew(true)}><span className="flex items-center gap-1.5"><Plus size={14} /> New order</span></Btn>
            </div>
          }
        />
      )}

      {!tv && (
        <div className="mb-2 flex items-center gap-3 text-[11px] text-zinc-500">
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            live · updated {Math.max(0, Math.round((Date.now() - syncedAt) / 1000))}s ago
          </span>
          {cancelled.length > 0 && (
            <button onClick={() => setShowCancelled(!showCancelled)} className="underline decoration-dotted underline-offset-2 hover:text-zinc-300">
              Cancelled ({cancelled.length})
            </button>
          )}
          {!isToday && <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-zinc-300">viewing {date} — read-only</span>}
        </div>
      )}

      {showCancelled && cancelled.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {cancelled.map((o) => (
            <div key={o.id} className="flex items-center justify-between rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-1.5 text-xs text-zinc-400">
              <span className="font-mono font-bold text-zinc-300">{o.code}</span>
              <span>{(o.items || []).map((i: any) => `${i.qty}× ${i.name}`).join(", ")}</span>
              <span className="text-red-300">{o.cancel_reason || "no reason recorded"}</span>
              <span>EGP {money(o.total)}</span>
            </div>
          ))}
        </div>
      )}

      <div ref={boardRef} className={`min-h-0 flex-1 bg-zinc-950 ${tv ? "p-4" : ""}`} style={{ zoom: tv ? 1.3 : 1 } as any}>
        {boardEmpty ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-zinc-800 p-10 text-center">
            <MessageCircle size={34} className="text-zinc-700" />
            <div className="text-lg font-semibold text-zinc-300">Waiting for orders</div>
            <div className="max-w-sm text-sm text-zinc-500">
              Guests order on WhatsApp{waNumber ? <> at <a className="font-semibold text-zinc-300 underline decoration-dotted" href={`https://wa.me/${waNumber.replace(/[^\d]/g, "")}`} target="_blank" rel="noreferrer">{waNumber}</a></> : ""} — new tickets land here the moment they confirm.
            </div>
            {!isToday && <div className="text-xs text-zinc-600">No orders on {date}.</div>}
          </div>
        ) : (
          <div
            className="grid h-full min-h-0 gap-4 max-md:grid-cols-1"
            style={window.innerWidth >= 768 ? { gridTemplateColumns: COLS.map((c) => {
              const n = visible.filter((o) => c.statuses.includes(o.status)).length;
              if (c.key === "done") return "0.72fr";
              return n === 0 ? "0.5fr" : "1fr";
            }).join(" ") } : undefined}
          >
            {COLS.map((col) => {
              const list = sortCol(visible.filter((o) => col.statuses.includes(o.status)), col.key);
              return (
                <div key={col.key} className="flex min-h-0 flex-col">
                  <div className="sticky top-0 z-10 mb-2 flex items-baseline justify-between rounded-lg bg-zinc-950/90 px-1 py-1 backdrop-blur">
                    <span className={`flex items-center gap-1.5 font-semibold ${tv ? "text-base" : "text-sm"}`}>
                      <col.Icon size={15} className={col.key === "preparing" ? "text-orange-400" : col.key === "ready" ? "text-emerald-400" : "text-zinc-400"} />
                      {col.label}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${list.length ? "bg-zinc-800 text-zinc-200" : "text-zinc-600"}`}>{list.length}</span>
                  </div>
                  <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                    {col.key === "done" ? (
                      <DoneDigest list={list} avgPrep={avgPrep} lateCount={lateCount} doneCount={done.length} />
                    ) : list.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-600">—</div>
                    ) : (
                      list.map((o) => (
                        <Ticket
                          key={o.id} o={o} col={col}
                          flash={flash.has(String(o.id)) || matchCode(o)}
                          branchName={branches.find((b: any) => b.key === o.branch)?.name || o.branch}
                          showBranch={branch === "all"}
                          readOnly={!isToday}
                          onAdvance={advance}
                          onCancel={() => setCancelTarget(o)}
                          onPrint={printTicket}
                        />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {undo && (
          <div className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl bg-zinc-800 px-4 py-2.5 text-sm text-zinc-100 shadow-xl">
            <span>{undo.order.code} → moved</span>
            <button
              onClick={() => { clearTimeout(undoTimer.current); advance(undo.order, undo.prev, false); setUndo(null); }}
              className="rounded-lg bg-zinc-100 px-3 py-1 text-xs font-bold text-zinc-900"
            >Undo</button>
          </div>
        )}
      </div>

      {cancelTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setCancelTarget(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-950 p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 text-sm font-semibold">Cancel {cancelTarget.code} — why?</div>
            <div className="space-y-2">
              {CANCEL_REASONS.map((r) => (
                <button key={r} onClick={() => { advance(cancelTarget, "cancelled", true, r); setCancelTarget(null); }}
                  className="w-full rounded-xl border border-zinc-700 px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800">
                  {r}
                </button>
              ))}
            </div>
            <button onClick={() => setCancelTarget(null)} className="mt-3 text-xs text-zinc-500 underline">keep the order</button>
          </div>
        </div>
      )}

      {showNew && <NewOrderModal branches={branches} onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load(); }} />}
    </div>
  );
}

function DoneDigest({ list, avgPrep, lateCount, doneCount }: any) {
  return (
    <>
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-sm">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">This day</div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div><div className="text-lg font-bold">{doneCount}</div><div className="text-[10px] text-zinc-500">done</div></div>
          <div><div className="text-lg font-bold">{avgPrep ?? "—"}</div><div className="text-[10px] text-zinc-500">avg min</div></div>
          <div><div className={`text-lg font-bold ${lateCount ? "text-red-400" : ""}`}>{lateCount}</div><div className="text-[10px] text-zinc-500">late now</div></div>
        </div>
      </div>
      {list.slice(-6).reverse().map((o: any) => {
        const t = typeOf(o.order_type);
        return (
          <div key={o.id} className="rounded-lg border border-zinc-800/70 bg-zinc-900/40 px-3 py-2 text-xs text-zinc-400">
            <div className="flex items-center justify-between">
              <span className="font-mono font-bold text-zinc-300">{o.code}</span>
              <span>{new Date(o.served_at || o.updated_at || o.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            </div>
            <div className="mt-0.5 flex items-center justify-between">
              <span className="flex items-center gap-1"><t.Icon size={11} /> {t.label.toLowerCase()} · {(o.items || []).reduce((s: number, i: any) => s + (Number(i.qty) || 1), 0)} items</span>
              <span className="tabular-nums text-zinc-300">EGP {money(o.total)}</span>
            </div>
          </div>
        );
      })}
    </>
  );
}

function Ticket({ o, col, flash, branchName, showBranch, readOnly, onAdvance, onCancel, onPrint }: any) {
  const step = nextFor(o, col);
  const [copied, setCopied] = useState(false);
  const road = col.key === "road";
  const age = road ? mins(o.out_at || o.updated_at || o.created_at) : mins(o.created_at);
  const lateAt = road ? 60 : 20;
  const warm = !readOnly && col.key !== "done" && age >= lateAt / 2 && age < lateAt;
  const late = !readOnly && col.key !== "done" && age >= lateAt;
  const t = typeOf(o.order_type);
  const phone = String(o.phone_number || "");
  const callable = /^[+\d][\d\s-]{6,}$/.test(phone);
  return (
    <div id={`tk-${o.id}`} className={`drop-shadow-md ${flash ? "animate-pulse" : ""}`}>
      <div
        onClick={() => !readOnly && step && onAdvance(o, step.next)}
        className={`overflow-hidden rounded-t-sm bg-[#fbfaf4] font-mono text-neutral-900 ${!readOnly && step ? "cursor-pointer" : ""} ${
          late ? "ring-2 ring-red-500 animate-[pulse_1.6s_ease-in-out_infinite]" : flash ? "ring-2 ring-emerald-400" : ""
        }`}
      >
        <div className={`h-2 ${t.bar}`} />
        <div className="flex items-center justify-between px-3 pt-2">
          <span className="flex items-center gap-1.5 text-[11px] font-bold tracking-widest">
            <t.Icon size={13} />
            {t.label}
            {o.order_type !== "delivery" && o.table_number ? ` · T${o.table_number}` : ""}
          </span>
          <span className={`flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${
            late ? "bg-red-600 text-white" : warm ? "bg-amber-400 text-amber-950" : t.chip
          }`}>
            {late && <AlertTriangle size={11} />}
            {readOnly ? new Date(o.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : `${age}'`}
          </span>
        </div>

        <div className="px-3 pb-1 pt-0.5 text-center">
          <div className="text-2xl font-extrabold tracking-[0.15em]">{o.code}</div>
          <div className="flex items-center justify-center gap-1 text-[10px] uppercase tracking-widest text-neutral-500">
            {phone.startsWith("walkin:") ? (o.diner_name || "walk-in") : (o.diner_name || phone || "guest")}
            {showBranch && o.branch ? ` · ${branchName}` : ""}
            {o.order_type === "pre_order" && o.pickup_time ? (
              <span className="flex items-center gap-0.5"><Clock size={10} /> {o.pickup_time}</span>
            ) : null}
          </div>
        </div>

        <div className="divide-y divide-dashed divide-neutral-300 border-y border-dashed border-neutral-400">
          {(o.items || []).map((i: any, idx: number) => (
            <div key={idx} className="px-3 py-1.5 text-[13px] leading-snug">
              <div className="flex justify-between gap-2">
                <span className="font-bold">{i.qty}x {i.name}</span>
                <span className="tabular-nums text-neutral-500">{money(Number(i.unit_price ?? i.price) * Number(i.qty))}</span>
              </div>
              {modLines(i).map((m, mi) => (
                <div key={mi} className="pl-3 text-xs font-semibold text-neutral-700">» {m}</div>
              ))}
            </div>
          ))}
        </div>

        {o.notes && (
          <div className="border-b border-dashed border-neutral-400 bg-amber-50 px-3 py-1.5 text-xs font-bold">
            !! {o.notes}
          </div>
        )}
        {o.order_type === "delivery" && (o.address || callable) && (
          <div className="flex items-start justify-between gap-2 border-b border-dashed border-neutral-400 px-3 py-1.5 text-xs">
            <span className="flex items-start gap-1"><MapPin size={12} className="mt-0.5 shrink-0" /> {o.address || "—"}</span>
            <span className="flex shrink-0 gap-2" onClick={(e) => e.stopPropagation()}>
              {o.map_link && (<a href={o.map_link} target="_blank" rel="noreferrer" className="font-bold underline">map</a>)}
              {callable && (<a href={`tel:${phone.replace(/[\s-]/g, "")}`} className="flex items-center gap-0.5 font-bold underline"><Phone size={11} /> call</a>)}
            </span>
          </div>
        )}

        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-sm font-extrabold tabular-nums">
            EGP {money(o.total)}
            {o.payment_method && (<span className="ml-1.5 text-[11px] font-normal uppercase text-neutral-500">{o.payment_method}</span>)}
          </span>
          <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
            {o.order_type === "delivery" && o.courier_token && (
              <button
                title="Copy the driver link — send it to the courier on WhatsApp"
                onClick={() => {
                  navigator.clipboard?.writeText(`https://ahlan-resto.vercel.app/driver/${o.courier_token}`).catch(() => {});
                  setCopied(true); setTimeout(() => setCopied(false), 1500);
                }}
                className={`rounded-sm border px-2 py-1 text-xs font-bold ${copied ? "border-emerald-400 text-emerald-600" : "border-neutral-300 hover:bg-neutral-100"}`}
              >{copied ? "✓" : <Bike size={13} />}</button>
            )}
            <button title="Print ticket" onClick={() => onPrint(o, branchName)}
              className="rounded-sm border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100"><Printer size={13} /></button>
            {!readOnly && col.key === "new" && (
              <button title="Cancel order" onClick={onCancel}
                className="rounded-sm border border-red-300 px-2 py-1 text-xs font-bold text-red-600 hover:bg-red-50"><X size={13} /></button>
            )}
            {!readOnly && step && (
              <button onClick={() => onAdvance(o, step.next)}
                className="rounded-sm bg-neutral-900 px-3 py-1 text-xs font-bold text-[#fbfaf4] hover:bg-neutral-700">{step.label}</button>
            )}
          </div>
        </div>
      </div>
      <div className="h-2" style={TEAR} />
    </div>
  );
}

// Phone orders & walk-ups get tickets too — same board, same bill rules.
function NewOrderModal({ branches, onClose, onCreated }: any) {
  const [menu, setMenu] = useState<any[]>([]);
  const [payments, setPayments] = useState<any>({});
  const [cart, setCart] = useState<Record<string, number>>({});
  const [orderType, setOrderType] = useState("pickup");
  const [branchKey, setBranchKey] = useState("");
  const [table, setTable] = useState("");
  const [address, setAddress] = useState("");
  const [pay, setPay] = useState("cash");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [cat, setCat] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get("/api/menu").then((r) => {
      const av = (r.data || []).filter((m: any) => m.available);
      setMenu(av);
      setCat(av[0]?.category || "");
    }).catch(() => {});
    api.get("/api/settings").then((r) => setPayments(r.data?.payments || {})).catch(() => {});
  }, []);

  const cats = [...new Set(menu.map((m) => m.category))];
  const round = (n: number) => Math.round(n * 100) / 100;
  const rateOf = (...keys: string[]) => { for (const k of keys) { const v = Number(payments[k]); if (Number.isFinite(v) && v > 0) return v > 1 ? v / 100 : v; } return 0; };
  const lines = menu.filter((m) => cart[m.id]).map((m) => ({ id: m.id, name: m.name, qty: cart[m.id], price: Number(m.price) }));
  const subtotal = round(lines.reduce((s, l) => s + l.price * l.qty, 0));
  const service = orderType === "dine_in" ? round(subtotal * rateOf("service_charge", "service_charge_pct")) : 0;
  const vat = round(subtotal * rateOf("tax", "tax_pct", "vat_pct"));
  const delivery = orderType === "delivery" ? round(Number(payments.delivery_fee) || 0) : 0;
  const total = round(subtotal + service + vat + delivery);

  async function create() {
    if (!lines.length || saving) return;
    setSaving(true);
    try {
      await api.post("/api/orders", {
        items: lines, order_type: orderType, branch: branchKey || null,
        table_number: table.trim() || null, address: address.trim() || null,
        payment_method: pay, diner_name: name.trim() || null,
        phone_number: phone.trim() || null,
      });
      onCreated();
    } catch (e: any) {
      alert(e.response?.data?.error || "Failed to create the order");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="grid max-h-[86vh] w-full max-w-3xl grid-rows-[auto_1fr_auto] overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
          <div className="text-sm font-semibold">New order — phone / walk-up</div>
          <button onClick={onClose}><X size={16} className="text-zinc-500 hover:text-zinc-200" /></button>
        </div>

        <div className="grid min-h-0 md:grid-cols-2">
          <div className="min-h-0 overflow-y-auto border-r border-zinc-800 p-4">
            <div className="mb-2 flex flex-wrap gap-1">
              {cats.map((c) => (
                <button key={c} onClick={() => setCat(c)}
                  className={`rounded-full px-2.5 py-1 text-[11px] ${cat === c ? "bg-zinc-200 font-semibold text-zinc-900" : "bg-zinc-800/70 text-zinc-400"}`}>
                  {c}
                </button>
              ))}
            </div>
            <div className="space-y-1">
              {menu.filter((m) => m.category === cat).map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800/70 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="truncate">{m.name}</div>
                    <div className="text-[11px] text-zinc-500">EGP {money(m.price)}</div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {cart[m.id] ? (
                      <>
                        <button onClick={() => setCart({ ...cart, [m.id]: Math.max(0, (cart[m.id] || 0) - 1) })}
                          className="rounded-md border border-zinc-700 p-1 text-zinc-300"><Minus size={12} /></button>
                        <span className="w-5 text-center text-sm font-bold tabular-nums">{cart[m.id]}</span>
                      </>
                    ) : null}
                    <button onClick={() => setCart({ ...cart, [m.id]: (cart[m.id] || 0) + 1 })}
                      className="rounded-md border border-zinc-700 p-1 text-zinc-300"><Plus size={12} /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto p-4 text-sm">
            <div className="mb-3 flex gap-1">
              {[["dine_in", "Dine-in"], ["pickup", "Pickup"], ["delivery", "Delivery"]].map(([k, l]) => (
                <button key={k} onClick={() => setOrderType(k)}
                  className={`flex-1 rounded-lg px-2 py-1.5 text-xs ${orderType === k ? "bg-zinc-200 font-semibold text-zinc-900" : "bg-zinc-800/70 text-zinc-400"}`}>
                  {l}
                </button>
              ))}
            </div>
            {branches.length > 1 && (
              <select value={branchKey} onChange={(e) => setBranchKey(e.target.value)}
                className="mb-2 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100">
                <option value="">Branch…</option>
                {branches.map((b: any) => (<option key={b.key} value={b.key}>{b.name}</option>))}
              </select>
            )}
            {orderType === "dine_in" && (
              <input value={table} onChange={(e) => setTable(e.target.value)} placeholder="Table (optional)"
                className="mb-2 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100" />
            )}
            {orderType === "delivery" && (
              <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Delivery address"
                className="mb-2 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100" />
            )}
            <div className="mb-2 grid grid-cols-2 gap-2">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Guest name"
                className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100" />
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (optional)"
                className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100" />
            </div>
            <select value={pay} onChange={(e) => setPay(e.target.value)}
              className="mb-3 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100">
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="instapay">InstaPay</option>
            </select>

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 text-xs">
              {lines.length === 0 ? (
                <div className="py-2 text-center text-zinc-600">Add items from the left</div>
              ) : (
                <>
                  {lines.map((l) => (
                    <div key={l.id} className="flex justify-between text-zinc-300">
                      <span>{l.qty}× {l.name}</span>
                      <span className="tabular-nums">{money(l.price * l.qty)}</span>
                    </div>
                  ))}
                  <div className="mt-2 border-t border-dashed border-zinc-700 pt-2 text-zinc-400">
                    <div className="flex justify-between"><span>Subtotal</span><span className="tabular-nums">{money(subtotal)}</span></div>
                    {service > 0 && <div className="flex justify-between"><span>Service</span><span className="tabular-nums">{money(service)}</span></div>}
                    {vat > 0 && <div className="flex justify-between"><span>VAT</span><span className="tabular-nums">{money(vat)}</span></div>}
                    {delivery > 0 && <div className="flex justify-between"><span>Delivery</span><span className="tabular-nums">{money(delivery)}</span></div>}
                    <div className="mt-1 flex justify-between text-sm font-bold text-zinc-100"><span>TOTAL</span><span className="tabular-nums">EGP {money(total)}</span></div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-zinc-800 px-5 py-3">
          <button onClick={onClose} className="rounded-xl border border-zinc-700 px-4 py-2 text-xs text-zinc-300">Cancel</button>
          <Btn onClick={create} className={lines.length ? "" : "pointer-events-none opacity-50"}>
            {saving ? "Creating…" : `Create ticket · EGP ${money(total)}`}
          </Btn>
        </div>
      </div>
    </div>
  );
}
