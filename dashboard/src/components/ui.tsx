import type { ReactNode } from "react";
import { useRef, useState } from "react";

// Two-step destructive button: first click arms ("Sure?"), second within 4s executes.
// Replaces confirm() everywhere — the sync dialog blocked the main thread (533-872ms INP).
export function ArmButton({ onConfirm, armedLabel = "Sure?", className = "", title, children }:
  { onConfirm: () => void; armedLabel?: ReactNode; className?: string; title?: string; children: ReactNode }) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return (
    <button type="button" title={title}
      onClick={() => {
        if (timer.current) clearTimeout(timer.current);
        if (!armed) { setArmed(true); timer.current = setTimeout(() => setArmed(false), 4000); return; }
        setArmed(false); onConfirm();
      }}
      className={armed ? "flex items-center gap-1 rounded-lg bg-red-600 px-2 py-1 text-xs font-semibold text-white" : className}>
      {armed ? armedLabel : children}
    </button>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-zinc-800 bg-zinc-900/60 ${className}`}>
      {children}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-zinc-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

const PILL_COLORS: Record<string, string> = {
  // reservations
  pending: "bg-yellow-500/15 text-yellow-300",
  awaiting_deposit: "bg-orange-500/15 text-orange-300",
  confirmed: "bg-emerald-500/15 text-emerald-300",
  reminded: "bg-emerald-500/15 text-emerald-300",
  arrived: "bg-sky-500/15 text-sky-300",
  seated: "bg-sky-500/15 text-sky-300",
  completed: "bg-zinc-500/15 text-zinc-300",
  no_show: "bg-red-500/15 text-red-300",
  cancelled: "bg-red-500/15 text-red-400",
  // tables
  free: "bg-emerald-500/15 text-emerald-300",
  reserved: "bg-amber-500/15 text-amber-300",
  bill: "bg-purple-500/15 text-purple-300",
  cleaning: "bg-zinc-500/15 text-zinc-300",
  blocked: "bg-red-500/15 text-red-300",
  // waitlist
  waiting: "bg-yellow-500/15 text-yellow-300",
  notified: "bg-sky-500/15 text-sky-300",
  left: "bg-red-500/15 text-red-300",
  // orders
  accepted: "bg-sky-500/15 text-sky-300",
  preparing: "bg-amber-500/15 text-amber-300",
  ready: "bg-emerald-500/15 text-emerald-300",
  served: "bg-zinc-500/15 text-zinc-300",
  paid: "bg-emerald-500/15 text-emerald-300",
  // misc
  open: "bg-emerald-500/15 text-emerald-300",
  upcoming: "bg-sky-500/15 text-sky-300",
  vip: "bg-fuchsia-500/15 text-fuchsia-300",
};

export function Pill({ value }: { value: string }) {
  const v = String(value ?? "");
  const cls = PILL_COLORS[v] || "bg-zinc-500/15 text-zinc-300";
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {v.replaceAll("_", " ")}
    </span>
  );
}

export function Btn({
  children, onClick, variant = "primary", className = "", disabled, type,
}: {
  children: ReactNode; onClick?: () => void;
  variant?: "primary" | "ghost" | "danger";
  className?: string; disabled?: boolean; type?: "button" | "submit";
}) {
  const styles = {
    primary: "font-semibold brightness-100 hover:brightness-110",
    ghost: "border border-zinc-700 text-zinc-200 hover:bg-zinc-800",
    danger: "bg-red-500/90 text-white hover:bg-red-500",
  }[variant];
  return (
    <button
      type={type || "button"}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-xl px-3.5 py-2 text-sm transition disabled:opacity-40 ${styles} ${className}`}
      style={variant === "primary" ? { backgroundColor: "var(--accent)", color: "var(--accent-contrast)" } : undefined}
    >
      {children}
    </button>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-amber-500 ${props.className || ""}`}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-amber-500 ${props.className || ""}`}
    />
  );
}

export function Empty({ text }: { text: string }) {
  return <div className="py-12 text-center text-sm text-zinc-500">{text}</div>;
}
