import { useEffect, useRef, useState } from "react";
import { Bell, BellRing, Flag, Check } from "lucide-react";
import { api } from "../config/api";
import { usePoll } from "../lib/usePoll";

type Notif = { id: number; type: string; title: string; body: string; read: boolean; created_at: string };

const TYPE_EMOJI: Record<string, string> = {
  handoff: "🤝", reservation: "📅", waitlist: "⏳", order: "🍽️", feedback: "⭐", system: "⚙️", staff_call: "🛎️", table_dispute: "🚩",
};

export default function NotificationBell() {
  const [items, setItems] = useState<Notif[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  usePoll(() => {
    api.get("/api/dashboard/notifications").then((r) => setItems(r.data.slice(0, 30))).catch(() => {});
  }, 5000);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const unread = items.filter((n) => !n.read).length;
  // table calls and table disputes can't wait for someone to open the bell: a banner with a
  // chime until a staff member taps "On it" (marks it read). Only the last 15 minutes.
  const urgent = items.filter((n) => !n.read && (n.type === "staff_call" || n.type === "table_dispute") && Date.now() - new Date(n.created_at).getTime() < 15 * 60_000);
  const chimed = useRef<Set<number>>(new Set());
  useEffect(() => {
    const fresh = urgent.filter((n) => !chimed.current.has(n.id));
    if (!fresh.length) return;
    fresh.forEach((n) => chimed.current.add(n.id));
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      [0, 0.18].forEach((t, i) => { const o = ctx.createOscillator(); const g = ctx.createGain(); o.frequency.value = i ? 1320 : 880; g.gain.setValueAtTime(0.0001, ctx.currentTime + t); g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.35); o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.4); });
    } catch { /* no audio permission yet — the banner still shows */ }
  }, [urgent.map((n) => n.id).join(",")]);

  async function markRead(n: Notif) {
    if (!n.read) {
      setItems((xs) => xs.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      await api.patch(`/api/dashboard/notifications/${n.id}`).catch(() => {});
    }
  }

  return (
    <div ref={ref} className="relative">
      {urgent.length > 0 && (
        <div className="fixed right-4 top-4 z-[100] flex w-80 flex-col gap-2">
          {urgent.slice(0, 4).map((n) => (
            <div key={n.id} className={`flex items-start gap-3 rounded-2xl border p-4 shadow-2xl ${n.type === "table_dispute" ? "border-amber-500/50 bg-amber-950" : "border-emerald-500/50 bg-emerald-950"}`}>
              <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${n.type === "table_dispute" ? "bg-amber-500/20 text-amber-300" : "animate-pulse bg-emerald-500/20 text-emerald-300"}`}>
                {n.type === "table_dispute" ? <Flag size={18} /> : <BellRing size={18} />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">{n.title}</div>
                <div className="mt-0.5 line-clamp-2 text-xs text-zinc-300">{n.body}</div>
              </div>
              <button onClick={() => markRead(n)} className="flex shrink-0 items-center gap-1 rounded-lg bg-white/10 px-2 py-1 text-xs font-medium hover:bg-white/20"><Check size={13} />On it</button>
            </div>
          ))}
        </div>
      )}
      <button onClick={() => setOpen((v) => !v)} className="relative rounded-xl p-2 text-zinc-400 transition hover:bg-zinc-900 hover:text-zinc-100">
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-zinc-950">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute left-0 z-50 mt-2 max-h-96 w-80 overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-900 shadow-xl">
          {items.length === 0 ? (
            <div className="p-6 text-center text-sm text-zinc-500">No notifications</div>
          ) : (
            items.map((n) => (
              <button key={n.id} onClick={() => markRead(n)} className={`block w-full border-b border-zinc-800/60 px-4 py-3 text-left transition hover:bg-zinc-800/50 ${n.read ? "opacity-50" : ""}`}>
                <div className="flex items-start gap-2">
                  <span>{TYPE_EMOJI[n.type] || "🔔"}</span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{n.title}</div>
                    <div className="mt-0.5 line-clamp-2 text-xs text-zinc-400">{n.body}</div>
                    <div className="mt-1 text-[10px] text-zinc-600">{new Date(n.created_at).toLocaleString()}</div>
                  </div>
                  {!n.read && <span className="ml-auto mt-1 h-2 w-2 shrink-0 rounded-full bg-amber-400" />}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
