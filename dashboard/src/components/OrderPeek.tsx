import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../config/api";
import { money, mins } from "../lib/format";

// Hover any order code, anywhere, and see the ticket without leaving the page. Most
// "let me just check that order" trips don't need a navigation at all — and every one
// you avoid is a place someone doesn't lose.
//
// The order list is fetched once and shared by every peek on the page for 30s, so a
// mouse wandering across ten codes costs one request, not ten. Clicking still navigates
// to the board (with the code, so it lands on the ticket) for anyone who wants the full
// thing.

let cache: { at: number; rows: any[] } | null = null;
let inflight: Promise<any[]> | null = null;

async function allOrders(): Promise<any[]> {
  if (cache && Date.now() - cache.at < 30_000) return cache.rows;
  if (inflight) return inflight;
  inflight = api.get("/api/orders", { params: { since_days: 120 } })
    .then((r) => { cache = { at: Date.now(), rows: r.data || [] }; return cache.rows; })
    .catch(() => [])
    .finally(() => { inflight = null; });
  return inflight;
}

const STATUS_WORD: Record<string, string> = {
  pending: "waiting to be accepted", accepted: "accepted", preparing: "in the kitchen",
  ready: "ready", out_for_delivery: "on the way", delivered: "delivered",
  served: "handed over", paid: "paid", cancelled: "cancelled",
};

export default function OrderPeek({ code, className = "" }: { code: string; className?: string }) {
  const [o, setO] = useState<any | null>(null);
  const [open, setOpen] = useState(false);
  const [missing, setMissing] = useState(false);
  const timer = useRef<any>(null);

  function enter() {
    // a small delay so brushing past a code doesn't flash a card at you
    timer.current = setTimeout(async () => {
      setOpen(true);
      if (o || missing) return;
      const rows = await allOrders();
      const hit = rows.find((r) => String(r.code || "").toLowerCase() === String(code).toLowerCase());
      if (hit) setO(hit); else setMissing(true);
    }, 220);
  }
  function leave() {
    clearTimeout(timer.current);
    setOpen(false);
  }

  return (
    <span className="relative inline-block" onMouseEnter={enter} onMouseLeave={leave} onFocus={enter} onBlur={leave}>
      <Link to={`/orders?code=${encodeURIComponent(code)}`}
        className={`cursor-pointer font-mono font-bold underline decoration-dotted underline-offset-2 ${className}`}>
        {code}
      </Link>
      {open && (
        <span role="tooltip"
          className="absolute bottom-full left-0 z-[90] mb-1.5 block w-64 rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-left shadow-xl">
          {!o && !missing && <span className="block text-xs text-zinc-500">Loading…</span>}
          {missing && <span className="block text-xs text-zinc-500">Couldn't find {code}.</span>}
          {o && (
            <>
              <span className="mb-1 flex items-baseline justify-between gap-2">
                <span className="font-mono text-sm font-bold text-zinc-100">{o.code}</span>
                <span className="text-xs tabular-nums text-zinc-400">EGP {money(o.total)}</span>
              </span>
              <span className="mb-1.5 block text-xs text-zinc-400">
                {STATUS_WORD[o.status] || o.status} · {mins(o.created_at)}m ago
                {o.order_type ? ` · ${String(o.order_type).replace("_", "-")}` : ""}
              </span>
              <span className="block space-y-0.5">
                {(o.items || []).slice(0, 5).map((i: any, n: number) => (
                  <span key={n} className="flex justify-between gap-2 text-xs text-zinc-300">
                    <span className="truncate">{i.qty}× {i.name}</span>
                  </span>
                ))}
                {(o.items || []).length > 5 && (
                  <span className="block text-xs text-zinc-600">+{o.items.length - 5} more</span>
                )}
              </span>
            </>
          )}
        </span>
      )}
    </span>
  );
}
