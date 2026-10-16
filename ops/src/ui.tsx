import type { ReactNode } from "react";

export function Card({ children, className = "", onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <div onClick={onClick} className={`rounded-2xl border border-zinc-800 bg-zinc-900/60 ${className}`}>
      {children}
    </div>
  );
}

export function Btn({ children, onClick, variant = "primary", className = "", type, disabled, title }: {
  children: ReactNode; onClick?: () => void; variant?: "primary" | "ghost"; className?: string;
  type?: "button" | "submit"; disabled?: boolean; title?: string;
}) {
  const styles = variant === "primary"
    ? "bg-amber-500 text-zinc-950 hover:bg-amber-400 font-semibold"
    : "border border-zinc-700 text-zinc-200 hover:bg-zinc-800";
  return (
    <button type={type || "button"} onClick={onClick} disabled={disabled} title={title}
      className={`rounded-xl px-3.5 py-2 text-sm transition disabled:opacity-40 ${styles} ${className}`}>
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

export function Empty({ text }: { text: string }) {
  return <div className="py-12 text-center text-sm text-zinc-500">{text}</div>;
}

/** A dropdown that matches Input. Options are [value, label] so values stay terse. */
export function Select({ value, onChange, options, className = "" }: {
  value: string; onChange: (v: string) => void; options: [string, string][]; className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`rounded-xl border border-zinc-700 bg-zinc-900 px-2.5 py-2 text-sm text-zinc-200 outline-none focus:border-amber-500 ${className}`}
    >
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

/** Segmented control — the time-window / mode picker used across views. */
export function Segments<T extends string>({ value, onChange, options, className = "" }: {
  value: T; onChange: (v: T) => void; options: [T, string][]; className?: string;
}) {
  return (
    <div className={`flex items-center gap-0.5 rounded-xl border border-zinc-800 bg-zinc-900/60 p-0.5 ${className}`}>
      {options.map(([v, l]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`rounded-lg px-2.5 py-1 text-xs transition ${
            value === v ? "bg-amber-500/15 font-semibold text-amber-300" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

export function Badge({ children, tone = "zinc", className = "", title }: {
  children: ReactNode; tone?: "zinc" | "amber" | "emerald" | "red" | "sky"; className?: string; title?: string;
}) {
  const tones = {
    zinc: "bg-zinc-800 text-zinc-300",
    amber: "bg-amber-500/15 text-amber-300",
    emerald: "bg-emerald-500/15 text-emerald-300",
    red: "bg-red-500/15 text-red-300",
    sky: "bg-sky-500/15 text-sky-300",
  } as const;
  return <span title={title} className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${tones[tone]} ${className}`}>{children}</span>;
}

/**
 * Label over a big number. Deliberately NOT tabular-nums: equal-width digits make a
 * standalone figure look loose at display sizes. Tabular is for columns of numbers.
 */
export function Stat({ label, value, sub, bad, hint, big }: {
  label: string; value: string; sub?: string; bad?: boolean; hint?: string; big?: boolean;
}) {
  return (
    <div title={hint} className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`font-bold leading-tight ${big ? "text-2xl" : "text-lg"} ${bad ? "text-red-400" : ""}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-zinc-500">{sub}</div>}
    </div>
  );
}

/** Proportional bar for the cost breakdowns — no chart library, one div. */
export function Bar({ pct, tone = "amber" }: { pct: number; tone?: "amber" | "sky" | "red" }) {
  const tones = { amber: "bg-amber-500/70", sky: "bg-sky-500/70", red: "bg-red-500/70" } as const;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
      <div className={`h-full rounded-full ${tones[tone]}`} style={{ width: `${Math.max(1, Math.min(100, pct))}%` }} />
    </div>
  );
}

/** Live/paused dot — polling stops while a trace is open, and that must be visible. */
export function LiveDot({ live, label }: { live: boolean; label?: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-zinc-500">
      <span className={`h-1.5 w-1.5 rounded-full ${live ? "animate-pulse bg-emerald-400" : "bg-zinc-600"}`} />
      {label || (live ? "live" : "paused")}
    </span>
  );
}

// ---------- formatting ----------

export function ago(iso?: string | null) {
  if (!iso) return "—";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (!isFinite(s)) return "—";
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

/** Local wall-clock — the raw ISO slice the console used to show was UTC and lied by 3h. */
export function clock(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(+d) ? "—" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function full(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(+d) ? "" : d.toLocaleString();
}

export function ms(v?: number | null) {
  if (v == null) return "…";
  return v < 1000 ? `${v}ms` : `${(v / 1000).toFixed(v < 10000 ? 2 : 1)}s`;
}

export function usd(v?: number | null, digits = 5) {
  if (!v) return "—";
  return `$${v.toFixed(digits)}`;
}

export function tokens(v?: number | null) {
  if (!v) return "0";
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v);
}
