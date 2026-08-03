import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, CalendarClock, Grid3X3, Hourglass, UtensilsCrossed,
  ChefHat, Users, MessageCircle, PartyPopper, Settings, LogOut, Flame,
} from "lucide-react";
import { api, session } from "../config/api";
import NotificationBell from "./NotificationBell";
import { unreadCount } from "../lib/unread";

// black or white text on the brand color, by luminance
function contrastFor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return "#1c1917";
  const n = parseInt(m[1], 16);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 145 ? "#1c1917" : "#ffffff";
}

const NAV = [
  { to: "/overview", label: "Overview", icon: LayoutDashboard, roles: ["admin", "manager"] },
  { to: "/reservations", label: "Reservations", icon: CalendarClock, roles: ["admin", "manager", "host"] },
  { to: "/floor", label: "Floor", icon: Grid3X3, roles: ["admin", "manager", "host"] },
  { to: "/waitlist", label: "Waitlist", icon: Hourglass, roles: ["admin", "manager", "host"] },
  { to: "/orders", label: "Orders", icon: ChefHat, roles: ["admin", "manager", "kitchen"] },
  { to: "/menu", label: "Menu", icon: UtensilsCrossed, roles: ["admin", "manager", "kitchen"] },
  { to: "/diners", label: "Diners", icon: Users, roles: ["admin", "manager", "host"] },
  { to: "/chats", label: "Chats", icon: MessageCircle, roles: ["admin", "manager", "host", "livechat"] },
  { to: "/events", label: "Events", icon: PartyPopper, roles: ["admin", "manager"] },
  { to: "/users", label: "Staff", icon: Users, roles: ["admin", "manager"] },
  { to: "/settings", label: "Settings", icon: Settings, roles: ["admin", "manager"] },
];

export default function DashboardLayout() {
  const nav = useNavigate();
  const { role, name, restaurant } = session();
  const [brand, setBrand] = useState<{ primary?: string; logo_url?: string; name?: string }>({});
  const [rtype, setRtype] = useState<string>("fine");
  // casual = orders-first, no reservations page (walk-in + waitlist world)
  const CASUAL_ORDER = ["/overview", "/orders", "/menu", "/floor", "/waitlist", "/chats", "/diners", "/events", "/users", "/settings"];
  const items = NAV
    .filter((n) => role === "admin" || n.roles.includes(role))
    .filter((n) => (rtype === "casual" ? n.to !== "/reservations" : true))
    .sort((a, b) => (rtype === "casual" ? CASUAL_ORDER.indexOf(a.to) - CASUAL_ORDER.indexOf(b.to) : 0));

  // unread chats badge — refreshed on a slow poll so reception never misses a guest
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!(role === "admin" || ["manager", "host", "livechat"].includes(role))) return;
    const load = () => api.get("/api/chat/sessions").then((r) => setUnread(unreadCount(r.data || []))).catch(() => {});
    load();
    const t = setInterval(load, 30000);
    const bump = () => load();
    window.addEventListener("chat-seen", bump);
    return () => { clearInterval(t); window.removeEventListener("chat-seen", bump); };
  }, [role]);

  useEffect(() => {
    api.get("/api/settings").then((r) => {
      const b = r.data?.basic_info?.brand || {};
      setBrand({ ...b, name: r.data?.name });
      setRtype(r.data?.basic_info?.restaurant_type || "fine");
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
            <div className="max-w-[120px] truncate text-[10px] text-zinc-500">powered by Ahlan</div>
          </div>
          <NotificationBell />
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
          {items.map(({ to, label, icon: Icon }) => (
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
              {to === "/chats" && unread > 0 && (
                <span className="rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none" style={{ backgroundColor: "var(--accent)", color: "var(--accent-contrast)" }}>
                  {unread}
                </span>
              )}
            </NavLink>
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
