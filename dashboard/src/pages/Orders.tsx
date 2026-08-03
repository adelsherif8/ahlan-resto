import { useEffect, useMemo, useRef, useState } from "react";
import {
  Inbox, Flame, CheckCircle2, Flag, Utensils, ShoppingBag, Clock, Bike, Receipt,
  Bell, BellOff, Monitor, Printer, Phone, MapPin, Store, X, AlertTriangle,
} from "lucide-react";
import { api, session } from "../config/api";
import { PageHeader } from "../components/ui";

// Fast-food ticket board (KDS): tickets flow left → right, one tap advances.
const COLS: { key: string; label: string; Icon: any; statuses: string[]; next?: string; nextLabel?: string }[] = [
  { key: "new", label: "New", Icon: Inbox, statuses: ["pending", "accepted"], next: "preparing", nextLabel: "Start" },
  { key: "preparing", label: "On the grill", Icon: Flame, statuses: ["preparing"], next: "ready", nextLabel: "Ready" },
  { key: "ready", label: "Ready", Icon: CheckCircle2, statuses: ["ready"], next: "served", nextLabel: "Handed over" },
  { key: "done", label: "Done", Icon: Flag, statuses: ["served", "delivered", "paid"] },
];

// Each order type gets its own paper-ticket colour, the way a real kitchen
// printer separates them at a glance. Tickets are printed paper — fixed light
// colours on purpose, they must look like paper in dark mode too.
const TYPE: Record<string, { label: string; Icon: any; bar: string; chip: string }> = {
  dine_in:       { label: "DINE IN",   Icon: Utensils,    bar: "bg-sky-500",     chip: "bg-sky-100 text-sky-800" },
  table_reorder: { label: "DINE IN",   Icon: Utensils,    bar: "bg-sky-500",     chip: "bg-sky-100 text-sky-800" },
  pickup:        { label: "TAKEAWAY",  Icon: ShoppingBag, bar: "bg-amber-500",   chip: "bg-amber-100 text-amber-800" },
  pre_order:     { label: "PRE-ORDER", Icon: Clock,       bar: "bg-emerald-500", chip: "bg-emerald-100 text-emerald-800" },
  delivery:      { label: "DELIVERY",  Icon: Bike,        bar: "bg-rose-500",    chip: "bg-rose-100 text-rose-800" },
};
const typeOf = (t: string) => TYPE[t] || { label: (t || "order").toUpperCase(), Icon: Receipt, bar: "bg-neutral-500", chip: "bg-neutral-200 text-neutral-700" };

// serrated tear edge at the bottom of every ticket, like paper off the printer
const TEAR = {
  backgroundImage: "linear-gradient(-45deg, transparent 70%, #fbfaf4 71%), linear-gradient(45deg, transparent 70%, #fbfaf4 71%)",
  backgroundSize: "12px 8px",
  backgroundRepeat: "repeat-x",
} as const;

function mins(since: string) {
  return Math.max(0, Math.round((Date.now() - new Date(since).getTime()) / 60000));
}

// money: whole numbers stay whole, fractions always show two places — never "302.1"
function money(n: any) {
  const v = Number(n || 0);
  return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// modifiers in the order a cook thinks: format → size → fries → drink → the rest
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

// two short beeps — a silent KDS gets ignored
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
  const staffBranch = session().branch || "";
  const [branch, setBranch] = useState<string>(staffBranch || localStorage.getItem("resto_branch_view") || "all");
  const [sound, setSound] = useState(localStorage.getItem("kds_sound") !== "off");
  const [undo, setUndo] = useState<{ order: any; prev: string } | null>(null);
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const [tv, setTv] = useState(false);
  const knownIds = useRef<Set<string> | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const undoTimer = useRef<any>(null);

  const load = (b = branch) =>
    api.get("/api/orders", { params: { branch: b } }).then((r) => setRows(r.data)).catch(() => {});
  useEffect(() => {
    api.get("/api/settings").then((r) => setBranches(r.data?.basic_info?.branches || [])).catch(() => {});
  }, []);
  useEffect(() => {
    load(branch);
    if (!staffBranch) localStorage.setItem("resto_branch_view", branch);
    const t = setInterval(() => load(branch), 7000);
    return () => clearInterval(t);
  }, [branch]);

  // TV mode follows the browser's fullscreen state (Esc exits both)
  useEffect(() => {
    const f = () => setTv(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", f);
    return () => document.removeEventListener("fullscreenchange", f);
  }, []);

  const today = new Date().toLocaleDateString("en-CA");
  const visible = useMemo(
    () => rows.filter((o) => o.status !== "cancelled" && String(o.created_at).slice(0, 10) === today),
    [rows]
  );
  const active = visible.filter((o) => !COLS[3].statuses.includes(o.status));
  const fresh = visible.filter((o) => COLS[0].statuses.includes(o.status));

  // new-ticket ding + flash + tab badge (skip the very first load)
  useEffect(() => {
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
  }, [visible.map((o) => o.id).join(","), sound]);

  async function advance(o: any, status: string, withUndo = true) {
    if (withUndo) {
      clearTimeout(undoTimer.current);
      setUndo({ order: o, prev: o.status });
      undoTimer.current = setTimeout(() => setUndo(null), 5000);
    }
    setRows((xs) => xs.map((x) => (x.id === o.id ? { ...x, status } : x)));
    await api.patch(`/api/orders/${o.id}`, { status }).catch(load);
  }

  // done-column digest numbers
  const done = visible.filter((o) => COLS[3].statuses.includes(o.status));
  const prepTimes = done
    .map((o) => (o.updated_at ? (new Date(o.updated_at).getTime() - new Date(o.created_at).getTime()) / 60000 : null))
    .filter((x): x is number => x !== null && x > 0 && x < 240);
  const avgPrep = prepTimes.length ? Math.round(prepTimes.reduce((s, x) => s + x, 0) / prepTimes.length) : null;
  const lateCount = active.filter((o) => mins(o.created_at) > 20).length;

  // New column: due-now first (oldest waiting on top), scheduled pre-orders after
  const sortCol = (list: any[], colKey: string) =>
    colKey !== "new" ? list : [...list].sort((a, b) =>
      (a.order_type === "pre_order" ? 1 : 0) - (b.order_type === "pre_order" ? 1 : 0) ||
      String(a.created_at).localeCompare(String(b.created_at)));

  return (
    <div className="flex h-full flex-col">
      {!tv && (
        <PageHeader
          title="Orders"
          subtitle={`${active.length} live · ${visible.length} today · EGP ${money(visible.reduce((s, o) => s + Number(o.total || 0), 0))}${avgPrep ? ` · avg ${avgPrep} min` : ""}${lateCount ? ` · ${lateCount} late` : ""}`}
          actions={
            <div className="flex items-center gap-2">
              <button
                title={sound ? "Sound on" : "Sound off"}
                onClick={() => { const n = !sound; setSound(n); localStorage.setItem("kds_sound", n ? "on" : "off"); if (n) ding(); }}
                className="rounded-xl border border-zinc-700 p-2.5 text-zinc-300"
              >{sound ? <Bell size={15} /> : <BellOff size={15} />}</button>
              <button
                title="Kitchen TV mode — fullscreen board"
                onClick={() => boardRef.current?.requestFullscreen?.().catch(() => {})}
                className="rounded-xl border border-zinc-700 p-2.5 text-zinc-300"
              ><Monitor size={15} /></button>
              {branches.length > 1 && (
                staffBranch ? (
                  <span className="flex items-center gap-1.5 rounded-full bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300">
                    <Store size={13} /> {branches.find((b: any) => b.key === staffBranch)?.name || staffBranch}
                  </span>
                ) : (
                  <select
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
                  >
                    <option value="all">All branches</option>
                    {branches.map((b: any) => (
                      <option key={b.key} value={b.key}>{b.name}</option>
                    ))}
                  </select>
                )
              )}
            </div>
          }
        />
      )}

      <div
        ref={boardRef}
        className={`min-h-0 flex-1 bg-zinc-950 ${tv ? "p-4" : ""}`}
        style={{ zoom: tv ? 1.3 : 1 } as any}
      >
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
                        key={o.id}
                        o={o}
                        col={col}
                        flash={flash.has(String(o.id))}
                        branchName={branches.find((b: any) => b.key === o.branch)?.name || o.branch}
                        showBranch={branch === "all"}
                        onAdvance={advance}
                        onPrint={printTicket}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>

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
    </div>
  );
}

function DoneDigest({ list, avgPrep, lateCount, doneCount }: any) {
  return (
    <>
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-sm">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Today</div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div><div className="text-lg font-bold">{doneCount}</div><div className="text-[10px] text-zinc-500">done</div></div>
          <div><div className="text-lg font-bold">{avgPrep ?? "—"}</div><div className="text-[10px] text-zinc-500">avg min</div></div>
          <div><div className={`text-lg font-bold ${lateCount ? "text-red-400" : ""}`}>{lateCount}</div><div className="text-[10px] text-zinc-500">late now</div></div>
        </div>
      </div>
      {list.slice(-6).reverse().map((o: any) => {
        const T = typeOf(o.order_type).Icon;
        return (
          <div key={o.id} className="flex items-center justify-between rounded-lg border border-zinc-800/70 bg-zinc-900/40 px-3 py-2 text-xs text-zinc-400">
            <span className="font-mono font-bold text-zinc-300">{o.code}</span>
            <span className="flex items-center gap-1"><T size={12} /> EGP {money(o.total)}</span>
            <span>{new Date(o.updated_at || o.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          </div>
        );
      })}
    </>
  );
}

function Ticket({ o, col, flash, branchName, showBranch, onAdvance, onPrint }: any) {
  const age = mins(o.created_at);
  const warm = col.key !== "done" && age >= 10 && age < 20;
  const late = col.key !== "done" && age >= 20;
  const t = typeOf(o.order_type);
  const phone = String(o.phone_number || "");
  const callable = /^[+\d][\d\s-]{6,}$/.test(phone);
  return (
    <div className={`drop-shadow-md ${flash ? "animate-pulse" : ""}`}>
      {/* the printed paper ticket — always paper-white, mono, dashed rules.
          Tap anywhere to advance; buttons stop propagation. */}
      <div
        onClick={() => col.next && onAdvance(o, col.next)}
        className={`overflow-hidden rounded-t-sm bg-[#fbfaf4] font-mono text-neutral-900 ${col.next ? "cursor-pointer" : ""} ${
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
          <span
            className={`flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${
              late ? "bg-red-600 text-white" : warm ? "bg-amber-400 text-amber-950" : t.chip
            }`}
          >
            {late && <AlertTriangle size={11} />}
            {age}'
          </span>
        </div>

        {/* the order number — big, like the top of a printed ticket */}
        <div className="px-3 pb-1 pt-0.5 text-center">
          <div className="text-2xl font-extrabold tracking-[0.15em]">{o.code}</div>
          <div className="flex items-center justify-center gap-1 text-[10px] uppercase tracking-widest text-neutral-500">
            {o.diner_name || phone || "guest"}
            {showBranch && o.branch ? ` · ${branchName}` : ""}
            {o.order_type === "pre_order" && o.pickup_time ? (
              <span className="flex items-center gap-0.5"><Clock size={10} /> {o.pickup_time}</span>
            ) : null}
          </div>
        </div>

        {/* one line per item, modifiers underneath */}
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
              {o.map_link && (
                <a href={o.map_link} target="_blank" rel="noreferrer" className="font-bold underline">map</a>
              )}
              {callable && (
                <a href={`tel:${phone.replace(/[\s-]/g, "")}`} className="flex items-center gap-0.5 font-bold underline"><Phone size={11} /> call</a>
              )}
            </span>
          </div>
        )}

        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-sm font-extrabold tabular-nums">
            EGP {money(o.total)}
            {o.payment_method && (
              <span className="ml-1.5 text-[11px] font-normal uppercase text-neutral-500">{o.payment_method}</span>
            )}
          </span>
          <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
            <button
              title="Print ticket"
              onClick={() => onPrint(o, branchName)}
              className="rounded-sm border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100"
            ><Printer size={13} /></button>
            {col.key === "new" && (
              <button
                title="Cancel order"
                onClick={() => onAdvance(o, "cancelled")}
                className="rounded-sm border border-red-300 px-2 py-1 text-xs font-bold text-red-600 hover:bg-red-50"
              ><X size={13} /></button>
            )}
            {col.next && (
              <button
                onClick={() => onAdvance(o, col.next)}
                className="rounded-sm bg-neutral-900 px-3 py-1 text-xs font-bold text-[#fbfaf4] hover:bg-neutral-700"
              >{col.nextLabel}</button>
            )}
          </div>
        </div>
      </div>
      {/* serrated tear-off edge */}
      <div className="h-2" style={TEAR} />
    </div>
  );
}
