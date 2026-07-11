import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { api } from "../config/api";

type Notif = { id: number; type: string; title: string; body: string; read: boolean; created_at: string };

const TYPE_EMOJI: Record<string, string> = {
  handoff: "🤝", reservation: "📅", waitlist: "⏳", order: "🍽️", feedback: "⭐", system: "⚙️",
};

export default function NotificationBell() {
  const [items, setItems] = useState<Notif[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = () => api.get("/api/dashboard/notifications").then((r) => setItems(r.data.slice(0, 30))).catch(() => {});
    load();
    const t = setInterval(load, 12000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const unread = items.filter((n) => !n.read).length;

  async function markRead(n: Notif) {
    if (!n.read) {
      setItems((xs) => xs.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      await api.patch(`/api/dashboard/notifications/${n.id}`).catch(() => {});
    }
  }

  return (
    <div ref={ref} className="relative">
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
