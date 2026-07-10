import type { ReactNode } from "react";

export function Card({ children, className = "", onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <div onClick={onClick} className={`rounded-2xl border border-zinc-800 bg-zinc-900/60 ${className}`}>
      {children}
    </div>
  );
}

export function Btn({ children, onClick, variant = "primary", className = "", type }: {
  children: ReactNode; onClick?: () => void; variant?: "primary" | "ghost"; className?: string; type?: "button" | "submit";
}) {
  const styles = variant === "primary"
    ? "bg-amber-500 text-zinc-950 hover:bg-amber-400 font-semibold"
    : "border border-zinc-700 text-zinc-200 hover:bg-zinc-800";
  return (
    <button type={type || "button"} onClick={onClick} className={`rounded-xl px-3.5 py-2 text-sm transition ${styles} ${className}`}>
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
