import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, CalendarClock, Grid3X3, Hourglass, UtensilsCrossed,
  ChefHat, Users, MessageCircle, PartyPopper, Settings, LogOut, Flame,
} from "lucide-react";
import { session } from "../config/api";
import NotificationBell from "./NotificationBell";

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
  const items = NAV.filter((n) => role === "admin" || n.roles.includes(role));

  function logout() {
    localStorage.clear();
    nav("/login");
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="flex w-60 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950">
        <div className="flex items-center gap-2 px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500 text-zinc-950">
            <Flame size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold leading-tight">Ahlan Resto</div>
            <div className="max-w-[120px] truncate text-xs text-zinc-400">{restaurant || "Dashboard"}</div>
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
                  isActive
                    ? "bg-amber-500/10 font-semibold text-amber-400"
                    : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
                }`
              }
            >
              <Icon size={17} />
              {label}
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
