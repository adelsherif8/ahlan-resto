import { useCallback, useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, CalendarClock, Grid3X3, Hourglass, UtensilsCrossed,
  ChefHat, Users, MessageCircle, PartyPopper, Settings, LogOut, Flame, Bike, Calculator, ChevronDown, Star, QrCode, FileText, Wallet, Bot } from "lucide-react";
import { api, session } from "../config/api";
import NotificationBell from "./NotificationBell";
import { unreadCount, isUnread } from "../lib/unread";
import { usePoll } from "../lib/usePoll";

// black or white text on the brand color, by luminance
function contrastFor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return "#1c1917";
  const n = parseInt(m[1], 16);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 145 ? "#1c1917" : "#ffffff";
}

// Grouped nav: Overview stands alone, then labelled sections — the flat list
// read as one long soup. Order inside a group = what staff reach for most.
const NAV = [
  { group: "", items: [
    { to: "/overview", label: "Overview", icon: LayoutDashboard, roles: ["admin", "manager"] },
    // Profit (/profit) and Bot quality (/quality) are deliberately NOT listed. Both still
    // exist and are reachable by URL for admins only — Profit is parked until costs are
    // entered, Bot quality is an internal tool heading for the ops console. Re-add a line
    // here to bring either back into the sidebar.
  ]},
  { group: "Service", items: [
    { to: "/reservations", label: "Reservations", icon: CalendarClock, roles: ["admin", "manager", "host"] },
    { to: "/waitlist", label: "Waitlist", icon: Hourglass, roles: ["admin", "manager", "host"] },
    { to: "/orders", label: "Orders", icon: ChefHat, roles: ["admin", "manager", "kitchen"] },
    { to: "/pos", label: "POS", icon: Calculator, roles: ["admin", "manager", "kitchen", "host"] },
    { to: "/delivery", label: "Delivery", icon: Bike, roles: ["admin", "manager", "kitchen"] },
    { to: "/floor", label: "Floor", icon: Grid3X3, roles: ["admin", "manager", "host"] },
  ]},
  { group: "Guests", items: [
    { to: "/chats", label: "Chats", icon: MessageCircle, roles: ["admin", "manager", "host", "livechat"] },
    { to: "/diners", label: "Diners", icon: Users, roles: ["admin", "manager", "host"] },
    { to: "/reviews", label: "Reviews", icon: Star, roles: ["admin", "manager", "host"] },
    { to: "/events", label: "Events", icon: PartyPopper, roles: ["admin", "manager"] },
  ]},
  { group: "Setup", items: [
    { to: "/menu", label: "Menu", icon: UtensilsCrossed, roles: ["admin", "manager", "kitchen"] },
    { to: "/menu-design", label: "Menu design", icon: FileText, roles: ["admin", "manager"] },
    { to: "/users", label: "Staff", icon: Users, roles: ["admin", "manager"] },
    { to: "/qr", label: "QR codes", icon: QrCode, roles: ["admin", "manager"] },
    { to: "/settings", label: "Settings", icon: Settings, roles: ["admin", "manager"] },
  ]},
];

export default function DashboardLayout() {
  const nav = useNavigate();
  const { role, name, restaurant } = session();
  const [brand, setBrand] = useState<{ primary?: string; logo_url?: string; name?: string }>({});
  const [rtype, setRtype] = useState<string>("fine");
  const [tablesOn, setTablesOn] = useState(true);
  // casual = orders-first: no reservations page AND no waitlist (fast food has
  // queues of tickets, not queues of parties); with table numbers off the Floor
  // page is decorative too — all three drop from the nav
  const groups = NAV.map((g) => ({
    ...g,
    items: g.items
      .filter((n) => role === "admin" || n.roles.includes(role))
      .filter((n) => (rtype === "casual" ? n.to !== "/reservations" && n.to !== "/waitlist" : true))
      .filter((n) => (rtype === "casual" && !tablesOn ? n.to !== "/floor" : true)),
  })).filter((g) => g.items.length);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem("nav_collapsed") || "{}"); } catch { return {}; }
  });
  function toggleGroup(label: string) {
    setCollapsed((c) => {
      const next = { ...c, [label]: !c[label] };
      localStorage.setItem("nav_collapsed", JSON.stringify(next));
      return next;
    });
  }

  // unread chats badge — refreshed on a slow poll so reception never misses a guest
  const [unread, setUnread] = useState(0);
  // A guest's message shouldn't wait for someone to happen to look at the Chats tab.
  // When a new one lands anywhere in the app, it says who and what — and clicking opens
  // that exact conversation. Only announces messages seen AFTER the first poll, so
  // opening the dashboard never dumps a pile of toasts for a backlog.
  const [toast, setToast] = useState<{ session: string; who: string; text: string } | null>(null);
  const seenAt = useRef<Map<string, string> | null>(null);
  const startedAt = useRef<number>(Date.now());
  const loadSessions = useCallback(() => {
    if (!(role === "admin" || ["manager", "host", "livechat"].includes(role))) return;
    api.get("/api/chat/sessions").then((r) => {
      const rows = r.data || [];
      setUnread(unreadCount(rows));
      const prev = seenAt.current;
      const next = new Map<string, string>(rows.map((s: any) => [s.session_id, String(s.last_message_at || "")]));
      if (prev) {
        // A brand-new guest has no previous entry, so requiring one silently excluded
        // first-ever messages — the main thing this is meant to catch. Unknown sessions
        // count too, as long as they arrived after this tab started watching.
        const fresh = rows.find((s: any) => {
          if (!s.last_message_at || !isUnread(s)) return false;
          const seen = prev.get(s.session_id);
          if (seen === undefined) return new Date(s.last_message_at).getTime() > startedAt.current;
          return seen !== String(s.last_message_at);
        });
        if (fresh) setToast({
          session: fresh.session_id,
          who: fresh.diner_name || fresh.phone_number || fresh.session_id,
          text: String(fresh.last_message || "").slice(0, 90),
        });
      }
      seenAt.current = next;
    }).catch(() => {});
  }, [role]);

  useEffect(() => {
    const bump = () => loadSessions();
    window.addEventListener("chat-seen", bump);
    return () => window.removeEventListener("chat-seen", bump);
  }, [loadSessions]);
  usePoll(loadSessions, 30000, [role]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [toast]);

  // Live urgency counts in the nav: you should be TOLD the board needs you, not have to
  // go and look. Late tickets and guests waiting on a human are the two things that get
  // worse the longer nobody notices, so they ride next to their page name.
  // Overview already fetches this exact payload on its own timer — polling it a second
  // time from the sidebar doubled the cost of the most expensive endpoint we have, for two
  // numbers the user is already looking at in bigger form.
  const onOverview = useLocation().pathname.startsWith("/overview");
  const [live, setLive] = useState<{ late: number; waiting: number }>({ late: 0, waiting: 0 });
  usePoll(() => {
    if (onOverview) return;
    api.get("/api/dashboard/kpis")
      .then((r) => setLive({
        late: r.data?.orders_today?.late_now || 0,
        waiting: r.data?.needs_attention || 0,
      }))
      .catch(() => {});
  }, 25000, [onOverview]);

  useEffect(() => {
    api.get("/api/settings").then((r) => {
      const b = r.data?.basic_info?.brand || {};
      setBrand({ ...b, name: r.data?.name });
      setRtype(r.data?.basic_info?.restaurant_type || "fine");
      setTablesOn(r.data?.basic_info?.services?.table_numbers !== false);
      if (b.primary) {
        document.documentElement.style.setProperty("--accent", b.primary);
        document.documentElement.style.setProperty("--accent-contrast", contrastFor(b.primary));
      }
      document.documentElement.dataset.theme = b.mode === "light" ? "light" : "dark";
      if (r.data?.name) document.title = r.data.name;
      // the browser tab wears the restaurant's own logo
      if (b.logo_url) {
        let link = document.querySelector('link[rel="icon"]') as HTMLLinkElement | null;
        if (!link) { link = document.createElement("link"); link.rel = "icon"; document.head.appendChild(link); }
        link.href = b.logo_url;
      }
    }).catch(() => {});
  }, []);

  function logout() {
    localStorage.clear();
    nav("/login");
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {toast && (
        <button
          onClick={() => { nav(`/chats?session=${encodeURIComponent(toast.session)}`); setToast(null); }}
          className="fixed bottom-5 right-5 z-[80] flex max-w-sm cursor-pointer items-start gap-2 rounded-2xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-left shadow-xl transition hover:border-zinc-500"
        >
          <MessageCircle size={16} className="mt-0.5 shrink-0" style={{ color: "var(--accent)" }} aria-hidden="true" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-zinc-100">{toast.who}</span>
            <span className="block truncate text-xs text-zinc-400">{toast.text}</span>
            <span className="mt-0.5 block text-xs text-zinc-600">click to open the chat</span>
          </span>
          <span onClick={(e) => { e.stopPropagation(); setToast(null); }}
            className="ml-1 shrink-0 rounded px-1 text-zinc-600 hover:text-zinc-300">✕</span>
        </button>
      )}
      <aside className="flex w-60 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950">
        <div className="flex items-center gap-2 px-5 py-5">
          {brand.logo_url ? (
            <img src={brand.logo_url} alt="" className="h-9 w-9 rounded-xl bg-white object-contain p-0.5" />
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ backgroundColor: "var(--accent)", color: "var(--accent-contrast)" }}>
              <Flame size={18} />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="max-w-[120px] truncate text-sm font-bold leading-tight">{brand.name || restaurant || "Dashboard"}</div>
            <div className="max-w-[120px] truncate text-[10px] text-zinc-500">powered by Munadim</div>
          </div>
          <NotificationBell />
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
          {groups.map((g) => (
            <div key={g.group || "top"}>
              {g.group && (
                <button onClick={() => toggleGroup(g.group)}
                  className="mt-3 flex w-full items-center justify-between px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-600 hover:text-zinc-400">
                  {g.group}
                  <ChevronDown size={12} className={`transition-transform ${collapsed[g.group] ? "-rotate-90" : ""}`} />
                </button>
              )}
              {(!g.group || !collapsed[g.group]) && g.items.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${
                      isActive ? "font-semibold" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
                    }`
                  }
                  style={({ isActive }) =>
                    isActive
                      ? { color: "var(--accent)", backgroundColor: "color-mix(in srgb, var(--accent) 12%, transparent)" }
                      : undefined
                  }
                >
                  <Icon size={17} />
                  <span className="flex-1">{label}</span>
                  {/* red = someone is waiting and it's getting worse; accent = unread,
                      which is information, not urgency. Never the same colour. */}
                  {to === "/orders" && live.late > 0 && (
                    <span title={`${live.late} running late`} aria-label={`${live.late} orders running late`}
                      className="rounded-full bg-red-500 px-1.5 py-0.5 text-xs font-bold leading-none text-white">
                      {live.late}
                    </span>
                  )}
                  {to === "/chats" && live.waiting > 0 && (
                    <span title={`${live.waiting} waiting on a human`} aria-label={`${live.waiting} conversations waiting on a human`}
                      className="rounded-full bg-red-500 px-1.5 py-0.5 text-xs font-bold leading-none text-white">
                      {live.waiting}
                    </span>
                  )}
                  {to === "/chats" && live.waiting === 0 && unread > 0 && (
                    <span aria-label={`${unread} unread`} className="rounded-full px-1.5 py-0.5 text-xs font-bold leading-none" style={{ backgroundColor: "var(--accent)", color: "var(--accent-contrast)" }}>
                      {unread}
                    </span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="border-t border-zinc-800 px-5 py-4">
          <div className="mb-2 text-sm font-medium">{name}</div>
          <div className="mb-3 text-xs uppercase tracking-wide text-zinc-500">{role}</div>
          <button
            onClick={logout}
            className="flex items-center gap-2 text-sm text-zinc-400 transition hover:text-red-400"
          >
            <LogOut size={15} /> Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto p-8">
        <Outlet />
      </main>
    </div>
  );
}
