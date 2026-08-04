import { useEffect, useMemo, useRef, useState } from "react";
import {
  Inbox, Flame, CheckCircle2, Flag, Utensils, ShoppingBag, Clock, Bike, Receipt,
  Bell, BellOff, Monitor, Printer, Phone, MapPin, Store, X, AlertTriangle,
  Plus, Search, MessageCircle, Minus,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api, session } from "../config/api";
import { money, mins } from "../lib/format";
import { modLines, printTicket as printSharedTicket } from "../lib/ticket";
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
  printSharedTicket(o, { typeLabel: typeOf(o.order_type).label, branchName });
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
  const nav = useNavigate();
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
              <Btn onClick={() => nav("/pos")}><span className="flex items-center gap-1.5"><Plus size={14} /> New order (POS)</span></Btn>
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

