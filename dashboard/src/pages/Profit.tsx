import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, TrendingDown, Wallet } from "lucide-react";
import { api } from "../config/api";
import { Card, PageHeader, Select, Empty } from "../components/ui";
import { money } from "../lib/format";

// Revenue tells you how busy you were; this page tells you what you kept.
// Everything here is computed from menu_items.cost × what actually sold — no estimates,
// no blended "industry average" food cost. Items without a recorded cost are excluded
// and reported as a coverage gap rather than quietly guessed.

export default function Profit() {
  const [days, setDays] = useState(30);
  const [d, setD] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get(`/api/dashboard/profit?days=${days}`)
      .then((r) => setD(r.data))
      .catch(() => setD(null))
      .finally(() => setLoading(false));
  }, [days]);

  if (loading && !d) return <Empty text="Loading…" />;
  if (!d) return <Empty text="Couldn't load profit — try again." />;

  const cur = d.currency || "EGP";
  const T = d.totals || {};
  const cov = d.coverage || {};
  const noCosts = cov.items_costed === 0;

  return (
    <div>
      <PageHeader
        title="Profit"
        subtitle="What you kept after food cost — not what you took"
        actions={
          <Select value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </Select>
        }
      />

      {noCosts ? (
        <Card className="p-6">
          <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-zinc-200">
            <Wallet size={15} className="text-amber-400" /> No costs recorded yet
          </div>
          <p className="max-w-xl text-sm text-zinc-400">
            Profit needs to know what a dish costs to make. Open the <Link to="/menu" className="text-[var(--accent)] hover:underline">Menu</Link>,
            edit an item, and fill in <span className="text-zinc-200">Cost to make</span>. Every item you cost starts appearing here — you don't
            have to do the whole menu before the numbers mean something, and nothing is ever estimated for you.
          </p>
        </Card>
      ) : (
        <>
          <CoverageNote cov={cov} cur={cur} />

          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label={`Food revenue · ${days}d`} value={`${cur} ${money(T.food_revenue)}`} hint="costed items only" />
            <Kpi label="Food cost" value={`${cur} ${money(T.food_cost)}`} hint={`${T.orders || 0} orders`} />
            <Kpi label="Gross profit" value={`${cur} ${money(T.gross_profit)}`} accent hint={`${cur} ${money(T.avg_profit_per_order)} per order`} />
            <Kpi label="Margin" value={T.margin_pct == null ? "—" : `${T.margin_pct}%`}
              hint={T.discounts > 0 ? `${cur} ${money(T.discounts)} given away in discounts` : "no discounts given"} />
          </div>

          {d.losers?.length > 0 && (
            <Card className="mb-4 border-red-500/40 bg-red-500/5 p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-red-300">
                <TrendingDown size={15} /> Losing money on every plate · {d.losers.length}
              </div>
              <div className="space-y-1">
                {d.losers.map((r: any) => (
                  <Link key={r.name} to={`/menu?item=${encodeURIComponent(r.name)}`}
                    className="flex cursor-pointer items-center justify-between gap-2 rounded px-1 py-0.5 text-xs transition hover:bg-red-500/10">
                    <span className="truncate text-zinc-200 underline decoration-dotted underline-offset-2">{r.name}</span>
                    <span className="shrink-0 tabular-nums text-zinc-400">
                      sells {cur} {money(r.price)} · costs {cur} {money(r.unit_cost)} ·
                      <span className="text-red-300"> {r.unit_margin > 0 ? "+" : ""}{money(r.unit_margin)}/plate</span> · {r.units}u
                    </span>
                  </Link>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-zinc-500">Re-price it, re-cost it, or take it off the menu — every one of these sold made the night worse.</p>
            </Card>
          )}

          <div className="mb-4 grid gap-4 lg:grid-cols-2">
            <Card className="p-4">
              <div className="mb-3 text-sm font-semibold text-zinc-200">Profit by day</div>
              <DayChart rows={d.by_day || []} cur={cur} />
            </Card>

            <Card className="p-4">
              <div className="mb-3 text-sm font-semibold text-zinc-200">Where the profit comes from</div>
              {(d.by_category || []).length === 0 ? <Empty text="Nothing sold in this window." /> : (
                <div className="space-y-2">
                  {d.by_category.map((c: any) => {
                    const top = Math.max(...d.by_category.map((x: any) => Math.abs(x.profit)), 1);
                    return (
                      <div key={c.category}>
                        <div className="flex items-baseline justify-between text-xs">
                          <span className="truncate pr-2 text-zinc-300">{c.category}</span>
                          <span className="shrink-0 tabular-nums text-zinc-400">
                            {cur} {money(c.profit)} <span className="text-zinc-600">· {c.margin_pct ?? "—"}%</span>
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                          <div className="h-full rounded-full" style={{
                            width: `${Math.max(2, (Math.abs(c.profit) / top) * 100)}%`,
                            backgroundColor: c.profit >= 0 ? "var(--accent)" : "#ef4444",
                          }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-4">
              <div className="mb-3 text-sm font-semibold text-zinc-200">Biggest earners</div>
              {(d.top || []).length === 0 ? <Empty text="No costed sales yet." /> : (
                <table className="w-full text-xs">
                  <thead className="text-zinc-500">
                    <tr className="border-b border-zinc-800">
                      <th className="pb-1.5 text-left font-medium">Dish</th>
                      <th className="pb-1.5 text-right font-medium">Units</th>
                      <th className="pb-1.5 text-right font-medium">Profit</th>
                      <th className="pb-1.5 text-right font-medium">Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.top.map((r: any) => (
                      <tr key={r.name} className="border-b border-zinc-900">
                        <td className="max-w-[1px] truncate py-1.5 pr-2 text-zinc-200">{r.name}</td>
                        <td className="py-1.5 text-right tabular-nums text-zinc-400">{r.units}</td>
                        <td className="py-1.5 text-right tabular-nums text-zinc-200">{money(r.profit)}</td>
                        <td className={`py-1.5 text-right tabular-nums ${r.margin_pct >= 60 ? "text-emerald-400" : r.margin_pct >= 30 ? "text-zinc-400" : "text-amber-400"}`}>
                          {r.margin_pct ?? "—"}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            <Card className="p-4">
              <div className="mb-1 text-sm font-semibold text-zinc-200">Missing a cost</div>
              <p className="mb-3 text-[11px] text-zinc-500">Sold in this window but not counted above. Top of the list first — those are the ones distorting your margin most.</p>
              {(d.uncosted || []).length === 0 ? (
                <div className="py-6 text-center text-xs text-emerald-400">Every dish that sold has a cost. Your margin number is the real one.</div>
              ) : (
                <div className="space-y-1">
                  {d.uncosted.slice(0, 14).map((r: any) => (
                    <div key={r.name} className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate text-zinc-300">{r.name}</span>
                      <span className="shrink-0 tabular-nums text-zinc-500">{r.units}u · {cur} {money(r.revenue)}</span>
                    </div>
                  ))}
                  <Link to="/menu" className="mt-2 inline-block text-[11px] text-[var(--accent)] hover:underline">Add costs on the Menu page →</Link>
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

// The number is only as true as its coverage — say so plainly, every time.
function CoverageNote({ cov, cur }: any) {
  const pct = cov.pct ?? 0;
  const missing = (cov.items_sold || 0) - (cov.items_costed || 0);
  if (pct >= 99) return null;
  const tone = pct >= 70 ? "border-zinc-800 bg-zinc-900/60 text-zinc-400" : "border-amber-500/40 bg-amber-500/10 text-zinc-300";
  return (
    <div className={`mb-4 flex items-start gap-2 rounded-2xl border px-4 py-2.5 text-xs ${tone}`}>
      <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-400" />
      <span>
        These numbers cover <span className="font-semibold text-zinc-100">{pct}%</span> of food revenue
        ({cur} {money(cov.revenue_covered)} of {cur} {money(cov.revenue_total)}).
        {missing > 0 && <> {missing} dish{missing > 1 ? "es" : ""} that sold {missing > 1 ? "have" : "has"} no cost recorded and {missing > 1 ? "are" : "is"} left out — nothing is estimated.</>}
      </span>
    </div>
  );
}

function Kpi({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums" style={accent ? { color: "var(--accent)" } : undefined}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-zinc-500">{hint}</div>}
    </Card>
  );
}

function DayChart({ rows, cur }: { rows: any[]; cur: string }) {
  if (!rows.length) return <Empty text="No sales in this window." />;
  const top = Math.max(...rows.map((r) => Math.abs(r.profit)), 1);
  const best = rows.reduce((a, b) => (b.profit > a.profit ? b : a), rows[0]);
  return (
    <>
      <div className="flex h-32 items-end gap-[3px]">
        {rows.map((r) => (
          <div key={r.day} className="group relative flex-1" title={`${r.day} · ${cur} ${money(r.profit)} profit`}>
            <div className="w-full rounded-t transition group-hover:brightness-125"
              style={{
                height: `${Math.max(2, (Math.abs(r.profit) / top) * 128)}px`,
                backgroundColor: r.profit >= 0 ? "var(--accent)" : "#ef4444",
              }} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-zinc-500">
        <span>{rows[0].day}</span>
        <span>Best day {best.day} · {cur} {money(best.profit)}</span>
        <span>{rows[rows.length - 1].day}</span>
      </div>
    </>
  );
}
