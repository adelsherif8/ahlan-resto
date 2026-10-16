import { useEffect, useState } from "react";
import { AlertTriangle, RefreshCw, ExternalLink, ChevronDown, ChevronRight, Info, TrendingUp, TrendingDown } from "lucide-react";
import { ops } from "./config";
import { Card, Btn, Empty, Badge, Segments, Bar, ago, full, ms, tokens } from "./ui";
import { money, type Currency } from "./pricing";
import { useCurrency } from "./hooks";

/**
 * COST — one subject only: what the platform spends. Revenue and per-restaurant billing
 * moved to Insights, where the economics already live; having both here duplicated that
 * page and meant eight similar-weight tiles before you reached a single chart.
 *
 * Structure, in priority order:
 *   1. one hero figure with a period-over-period delta  (the question the page answers)
 *   2. three supporting stats, deliberately quieter      (context, not headline)
 *   3. ONE time module — Day | Month, chart | table      (was three overlapping views)
 *   4. one breakdown, switchable by dimension
 *   5. outliers, folded away
 * Every caveat collapses into a single "data notes" disclosure instead of a stack of
 * full-width amber banners fencing in the numbers.
 *
 * Type scale is fixed at 11 / 12 / 14 / 18 / 28 — the page previously mixed seven sizes.
 */

type Row = {
  runs: number; errors: number; cost_usd: number; tokens_in: number; tokens_out: number;
  sessions: number; avg_ms: number; p95_ms: number; last_at: string | null;
};
type Prev =
  | { comparable: true; cost_usd: number; runs: number; sessions: number; days: number; from: string; to: string }
  | { comparable: false; reason: string };
type Rollup = {
  available: boolean; reason?: string; window_hours: number; truncated?: boolean; sampled_runs?: number;
  counted?: number; row_cap?: number | null; models_exact?: boolean; steps_exact?: boolean;
  aggregated?: boolean; flow_cost_available?: boolean; aggregate_error?: string | null;
  from?: string; to?: string | null; retention_days?: number;
  previous?: Prev | null;
  totals: Row & { cost_per_session: number };
  by_day: (Row & { day: string })[];
  by_flow: (Omit<Row, "cost_usd"> & { flow: string; cost_usd: number | null })[];
  by_restaurant: (Row & { restaurant: string; name: string; readable: boolean; reason: string | null; counted: number; capped: boolean })[];
  by_model: null;      // fetched on demand — see /api/ops/breakdown
  slow_steps: null;
  slowest: Lead[];
  costliest: Lead[];
};
type ModelRow = { model: string; calls: number; tokens_in: number; tokens_out: number; cost_usd: number; avg_ms: number };
type StepRow = { flow: string; node: string; calls: number; errors: number; cost_usd: number; avg_ms: number; p95_ms: number };
type Breakdown<T> = { available: boolean; reason?: string; exact: boolean; window_hours: number; clamped: boolean; asked_hours: number; sampled_runs: number | null; rows: T[] };

type Lead = { id: string; flow: string; restaurant: string | null; session_id: string; duration_ms: number | null; cost_usd: number; started_at: string };

const iso = (d: Date) => d.toISOString().slice(0, 10);
const WINDOW_LABEL: Record<string, string> = { "24": "24h", "72": "3 days", "168": "7 days", "336": "14 days" };
type Split = "flow" | "restaurant" | "model";
type Grain = "day" | "month";

/** Max bar width — without a cap, a few days render as giant saturated slabs. */
const BAR_W = 34;

export default function CostView({ onOpenTrace }: { onOpenTrace: (id: string) => void }) {
  const [data, setData] = useState<Rollup | null>(null);
  const [hours, setHours] = useState("168");
  const [preset, setPreset] = useState("168");
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const [split, setSplit] = useState<Split>("flow");
  const [grain, setGrain] = useState<Grain>("day");
  const [outliers, setOutliers] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const effHours = range ? Math.max(24, Math.round((Date.parse(range.to) - Date.parse(range.from)) / 3600_000) + 24) : Number(hours);
  const models = useBreakdown<ModelRow>("model", effHours, split === "model");
  const steps = useBreakdown<StepRow>("step", effHours, outliers);
  const [cur, setCur] = useCurrency();
  const m = (usdAmount: number, digits?: number) => money(usdAmount, "USD", cur, digits);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const qs = range ? `from=${range.from}&to=${range.to}` : `hours=${hours}`;
    ops.get(`/api/ops/rollup?${qs}`)
      .then((r) => alive && setData(r.data))
      .catch((e) => alive && setData({ available: false, reason: e?.message || "request failed" } as Rollup))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [hours, range?.from, range?.to, tick]);

  const retention = data?.retention_days ?? 14;
  const cutoff = iso(new Date(Date.now() - retention * 86400_000));
  const monthStart = iso(new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)));
  const PRESETS: [string, string][] = [["24", "24h"], ["168", "7 days"], ["336", "14 days"], ["month", "This month"], ["custom", "Dates…"]];

  function pick(id: string) {
    setPreset(id);
    if (id === "custom") return setRange({ from: cutoff, to: iso(new Date()) });
    if (id === "month") return setRange({ from: monthStart > cutoff ? monthStart : cutoff, to: iso(new Date()) });
    setRange(null);
    setHours(id);
  }

  const t = data?.totals;
  const shown = data?.available
    ? (data.to ? `${data.from} → ${data.to}` : `last ${WINDOW_LABEL[String(data.window_hours)] || `${data.window_hours}h`}`)
    : "";
  // never show one window's numbers under another window's label
  const stale = !!data?.available && (range
    ? data.from !== range.from || (data.to || "") !== range.to
    : Number(data.window_hours) !== Number(hours));

  // Every caveat in one place, so the numbers aren't fenced in by amber.
  const notes: { level: "warn" | "info"; text: string }[] = [];
  if (data?.available && t) {
    if (data.truncated) notes.push({ level: "warn", text: `Read ${t.runs.toLocaleString()} of ${(data.counted || 0).toLocaleString()} runs — capped at ${(data.row_cap || 0).toLocaleString()} per restaurant, so this is a floor.` });
    if (data.aggregated === false) notes.push({
      level: "warn",
      // Say WHY. This used to read "deploy the current flows", which was true only while
      // production lagged — once it caught up, the same message sent you chasing a deploy
      // that had already happened instead of the query that actually failed.
      text: data.aggregate_error
        ? `Totals fell back to row-reading, so they are capped and per-flow spend is unavailable. Cause: ${data.aggregate_error}. Narrowing the window usually clears it.`
        : "Totals fell back to row-reading, so they are capped and per-flow spend is unavailable — this flows build cannot aggregate in Postgres.",
    });
    notes.push({ level: "info", text: `Traces are purged after ${retention} days, so any window reaching further back is a floor. Month-by-month history comes from daily snapshots instead.` });
    notes.push({ level: "info", text: "p95 is the worst restaurant's, not a platform-wide percentile — percentiles cannot be merged across databases. Per-restaurant p95 in the breakdown is exact." });
    if (data.previous && data.previous.comparable === false) notes.push({ level: "info", text: `No period-over-period comparison: ${data.previous.reason}.` });
  }
  const warnCount = notes.filter((n) => n.level === "warn").length;

  const prev = data?.previous && data.previous.comparable ? data.previous : null;
  const delta = prev && prev.cost_usd > 0 && t ? ((t.cost_usd - prev.cost_usd) / prev.cost_usd) * 100 : null;

  return (
    <div className="h-full overflow-y-auto p-6">
      {/* ── one filter row, above everything it scopes ── */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div>
          <h2 className="text-lg font-bold">Cost</h2>
          <p className="text-xs text-zinc-400">What the platform spends, and where it goes. Revenue lives on Insights.</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Segments value={cur} onChange={setCur} options={[["EGP", "EGP"], ["USD", "USD"]]} />
          <Segments value={preset} onChange={pick} options={PRESETS} />
          {preset === "custom" && range && (
            <div className="flex items-center gap-1 rounded-xl border border-zinc-800 bg-zinc-900/60 px-2 py-1">
              <input type="date" value={range.from} min={cutoff} max={range.to}
                onChange={(e) => setRange({ ...range, from: e.target.value })}
                className="bg-transparent text-xs text-zinc-200 outline-none" />
              <span className="text-zinc-600">→</span>
              <input type="date" value={range.to} min={range.from} max={iso(new Date())}
                onChange={(e) => setRange({ ...range, to: e.target.value })}
                className="bg-transparent text-xs text-zinc-200 outline-none" />
            </div>
          )}
          <Btn variant="ghost" onClick={() => setTick((x) => x + 1)}>
            <span className="flex items-center gap-1.5"><RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh</span>
          </Btn>
        </div>
      </div>

      {!data ? <Empty text="Loading…" /> : !data.available ? (
        <Card className="p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-400" />
            <div>
              <h3 className="text-sm font-semibold">No execution history to total up</h3>
              <p className="mt-1 text-xs text-zinc-400">
                Costs come from <code className="text-zinc-300">flow_executions</code> in each tenant's database. Migration 003 creates it.
              </p>
              {data.reason && <p className="mt-2 text-[11px] text-zinc-500">Database said: {data.reason}</p>}
            </div>
          </div>
        </Card>
      ) : (
        <div className={`transition-opacity ${loading ? "opacity-60" : ""}`}>
          {/* ── 1. the hero ── */}
          <Card className="mb-4 overflow-hidden">
            <div className="grid gap-px bg-zinc-800 md:grid-cols-[1.4fr_1fr]">
              <div className="bg-zinc-900/60 p-5">
                <div className="text-[11px] uppercase tracking-wide text-zinc-500">Spend</div>
                <div className="mt-1 flex flex-wrap items-baseline gap-3">
                  <span className="text-[28px] font-bold leading-none">{m(t!.cost_usd, cur === "USD" ? 2 : 0)}</span>
                  {delta !== null && (
                    <span className={`flex items-center gap-1 text-xs font-semibold ${delta > 0 ? "text-amber-300" : "text-emerald-400"}`}>
                      {delta > 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                      {delta > 0 ? "+" : ""}{Math.round(delta)}%
                    </span>
                  )}
                </div>
                <div className="mt-1.5 text-xs text-zinc-400">
                  {shown}{stale && <span className="text-sky-300"> — refreshing</span>}
                  {prev && <span className="text-zinc-500"> · vs {m(prev.cost_usd)} the {prev.days} days before</span>}
                </div>
                <button onClick={() => setNotesOpen((v) => !v)}
                  className={`mt-3 flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] transition ${
                    warnCount ? "border-amber-500/50 bg-amber-500/10 text-amber-200" : "border-zinc-700 text-zinc-400 hover:bg-zinc-800"
                  }`}>
                  <Info size={11} />
                  {notes.length} data note{notes.length === 1 ? "" : "s"}{warnCount ? ` · ${warnCount} to read` : ""}
                  {notesOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                </button>
              </div>

              <div className="grid grid-cols-3 gap-px bg-zinc-800">
                <MiniStat label="per convo" value={m(t!.cost_per_session)} sub={`${t!.sessions.toLocaleString()} convos`} />
                <MiniStat label="runs" value={t!.runs.toLocaleString()} sub={t!.errors ? `${t!.errors.toLocaleString()} failed` : "none failed"} bad={t!.errors > 0} />
                <MiniStat label="p95" value={ms(t!.p95_ms)} sub={`avg ${ms(t!.avg_ms)} · ${tokens(t!.tokens_in + t!.tokens_out)} tok`} bad={t!.p95_ms > 15000} />
              </div>
            </div>

            {notesOpen && (
              <div className="space-y-1.5 border-t border-zinc-800 bg-zinc-950/50 px-5 py-3">
                {notes.map((n, i) => (
                  <div key={i} className="flex items-start gap-2 text-[11px] leading-relaxed">
                    {n.level === "warn"
                      ? <AlertTriangle size={11} className="mt-0.5 shrink-0 text-amber-400" />
                      : <Info size={11} className="mt-0.5 shrink-0 text-zinc-600" />}
                    <span className={n.level === "warn" ? "text-amber-200" : "text-zinc-400"}>{n.text}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* ── 2. ONE time module: same question, two zoom levels ── */}
          <Card className="mb-4 overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-4 py-2.5">
              <h3 className="text-sm font-semibold">Spend over time</h3>
              <span className="text-[11px] text-zinc-500">
                {grain === "day" ? "from the traces in this window" : "from daily snapshots — the only source that outlives the purge"}
              </span>
              <Segments className="ml-auto" value={grain} onChange={setGrain} options={[["day", "Day"], ["month", "Month"]]} />
            </div>
            {grain === "day"
              ? <DayChart days={data.by_day} m={m} cur={cur} />
              : <MonthList m={m} retentionDays={retention} />}
          </Card>

          {/* ── 3. one breakdown, switchable ── */}
          <Card className="mb-4 overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-4 py-2.5">
              <h3 className="text-sm font-semibold">Where it goes</h3>
              <Segments className="ml-auto" value={split} onChange={setSplit}
                options={[["flow", "By flow"], ["restaurant", "By restaurant"], ["model", "By model"]]} />
            </div>
            {split === "flow" ? <FlowTable rows={data.by_flow} m={m} costAvailable={data.flow_cost_available !== false} />
              : split === "restaurant" ? <RestaurantTable rows={data.by_restaurant} m={m} />
              : <ModelTable b={models.data} loading={models.loading} m={m} />}
          </Card>

          {/* ── 4. outliers, folded away ── */}
          <Card className="overflow-hidden">
            <button onClick={() => setOutliers((v) => !v)}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-left transition hover:bg-zinc-900">
              {outliers ? <ChevronDown size={14} className="text-zinc-500" /> : <ChevronRight size={14} className="text-zinc-500" />}
              <h3 className="text-sm font-semibold">Slow &amp; expensive</h3>
              <span className="text-[11px] text-zinc-500">the individual runs and steps worth opening</span>
            </button>
            {outliers && (
              <div className="grid gap-px bg-zinc-800 md:grid-cols-3">
                <StepTable b={steps.data} loading={steps.loading} m={m} />
                <Leaderboard title="Slowest runs" rows={data.slowest} metric={(r) => ms(r.duration_ms)} onOpenTrace={onOpenTrace} />
                <Leaderboard title="Costliest runs" rows={data.costliest} metric={(r) => m(r.cost_usd)} onOpenTrace={onOpenTrace} />
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

/**
 * Fetches a breakdown only once something actually displays it. These two queries expand
 * the `nodes` jsonb and were 11.6 of the Cost page's 15 seconds, to fill a table behind a
 * tab and one behind a collapsed section.
 */
function useBreakdown<T>(kind: "model" | "step", hours: number, on: boolean) {
  const [data, setData] = useState<Breakdown<T> | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!on) return;
    let alive = true;
    setLoading(true);
    ops.get(`/api/ops/breakdown?kind=${kind}&hours=${hours}`)
      .then((r) => alive && setData(r.data))
      .catch((e) => alive && setData({
        available: false, reason: e?.response?.status === 404 ? "not deployed yet" : e?.message,
        exact: false, window_hours: hours, clamped: false, asked_hours: hours, sampled_runs: null, rows: [],
      }))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [kind, hours, on]);
  return { data, loading };
}

/** Supporting stat: same information as before, deliberately quieter than the hero. */
function MiniStat({ label, value, sub, bad }: { label: string; value: string; sub: string; bad?: boolean }) {
  return (
    <div className="bg-zinc-900/60 px-3 py-4">
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold leading-tight ${bad ? "text-red-400" : "text-zinc-100"}`}>{value}</div>
      <div className="mt-0.5 text-[11px] text-zinc-500">{sub}</div>
    </div>
  );
}

/**
 * Spend per day. One series → one colour for every bar; a darker-where-bigger ramp would
 * only re-encode height as hue. Bars are capped so a short window isn't a row of slabs,
 * the fill stays recessive until hovered, and a table twin means no value is hover-only.
 */
function DayChart({ days, m, cur }: { days: (Row & { day: string })[]; m: (u: number, d?: number) => string; cur: Currency }) {
  const [asTable, setAsTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);

  const rows = [...days].sort((a, b) => (a.day < b.day ? -1 : 1)); // time flows left → right
  const max = Math.max(1e-9, ...rows.map((d) => d.cost_usd));
  const peak = rows.reduce((best, d, i) => (d.cost_usd > (rows[best]?.cost_usd ?? -1) ? i : best), 0);
  const every = Math.max(1, Math.ceil(rows.length / 8));
  const label = (isoDay: string) => {
    const d = new Date(`${isoDay}T00:00:00`);
    return isNaN(+d) ? isoDay.slice(5) : d.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  if (rows.length === 0) return <Empty text="No runs in this window." />;
  // fewer than four points is a list, not a chart
  if (rows.length < 4) return <DayTable rows={rows} m={m} few />;

  return (
    <>
      <div className="flex items-center justify-end px-4 pt-2">
        <button onClick={() => setAsTable((v) => !v)} className="text-[11px] text-zinc-500 transition hover:text-amber-400">
          {asTable ? "chart" : "table"}
        </button>
      </div>
      {asTable ? <DayTable rows={rows} m={m} /> : (
        <div className="px-4 pb-3 pt-4">
          <div className="flex items-end gap-1.5" style={{ height: 168 }}>
            {rows.map((d, i) => {
              const h = (d.cost_usd / max) * 100;
              const on = hover === i;
              const show = i === peak || i === rows.length - 1 || on;
              return (
                <div key={d.day}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover((v) => (v === i ? null : v))}
                  style={{ maxWidth: BAR_W }}
                  className="relative flex h-full min-w-0 flex-1 cursor-default flex-col justify-end">
                  {show && (
                    <div className="mb-1 whitespace-nowrap text-center text-[11px] tabular-nums text-zinc-400">
                      {m(d.cost_usd, cur === "USD" ? 2 : 0)}
                    </div>
                  )}
                  <div style={{ height: `${Math.max(2, h)}%` }}
                    className={`w-full rounded-t-[3px] transition-colors ${on ? "bg-amber-500/85" : "bg-amber-500/35"}`} />
                  {on && (
                    <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-5 w-44 -translate-x-1/2 rounded-lg border border-zinc-700 bg-zinc-900 p-2 text-left shadow-xl">
                      <div className="text-xs font-semibold text-zinc-100">{label(d.day)}</div>
                      <div className="mt-1 space-y-0.5 text-[11px] tabular-nums text-zinc-400">
                        <Kv k="spend" v={m(d.cost_usd)} strong />
                        <Kv k="runs" v={d.runs.toLocaleString()} />
                        <Kv k="conversations" v={String(d.sessions)} />
                        {d.errors > 0 && <Kv k="failed" v={String(d.errors)} bad />}
                        <Kv k="avg run" v={ms(d.avg_ms)} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {/* hairline baseline, one shade off the surface — never dashed */}
          <div className="mt-1 h-px w-full bg-zinc-800" />
          <div className="mt-1 flex gap-1.5">
            {rows.map((d, i) => (
              <div key={d.day} style={{ maxWidth: BAR_W }} className="min-w-0 flex-1 truncate text-center text-[11px] text-zinc-500">
                {i % every === 0 || i === rows.length - 1 ? label(d.day) : ""}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function Kv({ k, v, strong, bad }: { k: string; v: string; strong?: boolean; bad?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${bad ? "text-red-400" : ""}`}>
      <span>{k}</span><span className={strong ? "text-zinc-200" : ""}>{v}</span>
    </div>
  );
}

function DayTable({ rows, m, few }: { rows: (Row & { day: string })[]; m: (u: number, d?: number) => string; few?: boolean }) {
  return (
    <>
      {few && (
        <div className="px-4 pt-3 text-[11px] text-zinc-500">
          Only {rows.length} day{rows.length === 1 ? "" : "s"} in this window — a list reads better than a chart.
        </div>
      )}
      <table className="w-full text-xs">
        <thead className="text-zinc-500">
          <tr className="border-b border-zinc-800"><Th>day</Th><Th right>runs</Th><Th right>convos</Th><Th right>errors</Th><Th right>spend</Th></tr>
        </thead>
        <tbody>
          {[...rows].reverse().map((d) => (
            <tr key={d.day} className="border-b border-zinc-800/60 last:border-0">
              <Td><span className="font-mono text-zinc-200">{d.day}</span></Td>
              <Td num>{d.runs.toLocaleString()}</Td>
              <Td num>{d.sessions}</Td>
              <Td num className={d.errors ? "text-red-400" : ""}>{d.errors}</Td>
              <Td num className="font-semibold">{m(d.cost_usd)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

type MonthRow = {
  month: string; runs: number; errors: number; sessions: number;
  cost_usd: number; cost_guest_usd: number; cost_test_usd: number;
  orders_billable: number; order_value_egp: number;
  days_covered: number; restaurants: string[]; first_day: string; last_day: string;
};

/**
 * Months, from the cost_daily snapshots (migration 039). flow_executions cannot answer
 * this: the janitor purges traces at 14 days, so July had 36 rows left — all failures,
 * $0.0005 — for a month the bot worked through. A month whose snapshots started late is
 * labelled a floor rather than presented as the bill.
 */
function MonthList({ m, retentionDays }: { m: (u: number, d?: number) => string; retentionDays: number }) {
  const [data, setData] = useState<{ available: boolean; reason?: string; months: MonthRow[] } | null>(null);

  useEffect(() => {
    let alive = true;
    ops.get("/api/ops/history?months=12")
      .then((r) => alive && setData(r.data))
      .catch((e) => alive && setData({ available: false, reason: e?.response?.status === 404 ? "endpoint not deployed yet" : e?.message, months: [] }));
    return () => { alive = false; };
  }, []);

  if (!data) return <Empty text="Loading…" />;
  const months = data.months || [];
  const max = Math.max(1e-9, ...months.map((x) => x.cost_usd));
  const daysIn = (ym: string) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();
  const name = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString([], { month: "long", year: "numeric", timeZone: "UTC" });

  if (!data.available) {
    return (
      <div className="px-4 py-4 text-[11px] text-zinc-500">
        Cost history unavailable: {data.reason}. Run <code className="text-zinc-400">migration 039</code> on the control DB — flows then records one row per restaurant per day.
      </div>
    );
  }
  if (months.length === 0) {
    return (
      <div className="px-4 py-4 text-[11px] text-zinc-500">
        No snapshots yet. History accumulates from the first hourly snapshot; earlier months cannot be recovered because their traces are already deleted.
      </div>
    );
  }

  return (
    <>
      <div className="divide-y divide-zinc-800/60">
        {months.map((x) => {
          // The CURRENT month is short simply because it hasn't finished — badging that as
          // a purged "floor" cried wolf every single month. Only a past month with missing
          // days actually lost data.
          const nowYm = new Date().toISOString().slice(0, 7);
          const inProgress = x.month === nowYm;
          const elapsed = inProgress ? new Date().getUTCDate() : daysIn(x.month);
          const partial = x.days_covered < elapsed;
          return (
            <div key={x.month} className="px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="w-32 shrink-0 text-sm font-semibold text-zinc-100">{name(x.month)}</span>
                <span className="text-[11px] tabular-nums text-zinc-500">
                  {x.runs.toLocaleString()} runs · {x.sessions.toLocaleString()} convos
                  {x.orders_billable ? ` · ${x.orders_billable} orders` : ""}
                </span>
                {partial ? (
                  <Badge tone="amber" title={`only ${x.days_covered} of ${elapsed} elapsed days were snapshotted — the rest was purged before it could be captured`}>
                    {x.days_covered}/{elapsed} days · floor
                  </Badge>
                ) : inProgress ? (
                  <Badge title={`${x.days_covered} days so far; the month is still running`}>in progress</Badge>
                ) : null}
                <span className="ml-auto shrink-0 text-sm font-semibold tabular-nums">{m(x.cost_usd)}</span>
              </div>
              <div className="mt-1.5"><Bar pct={(x.cost_usd / max) * 100} /></div>
              {x.cost_test_usd > 0 && (
                <div className="mt-1 text-[11px] text-zinc-500">
                  serving guests {m(x.cost_guest_usd)} · our own testing {m(x.cost_test_usd)}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="border-t border-zinc-800 px-4 py-2 text-[11px] text-zinc-500">
        Traces are purged after {retentionDays} days, so a month marked <span className="text-amber-300">floor</span> was
        already partly gone when first snapshotted and its real spend was higher. August read $33.57 on the provider's bill.
      </div>
    </>
  );
}

function ShareCell({ value, max }: { value: number; max: number }) {
  return <div className="w-16"><Bar pct={(value / Math.max(1e-9, max)) * 100} /></div>;
}

function FlowTable({ rows, m, costAvailable }: { rows: Rollup["by_flow"]; m: (u: number, d?: number) => string; costAvailable: boolean }) {
  const max = Math.max(1e-9, ...rows.map((r) => r.cost_usd || 0));
  if (!rows.length) return <Empty text="No runs in this window." />;
  return (
    <>
      <table className="w-full text-xs">
        <thead className="text-zinc-500">
          <tr className="border-b border-zinc-800"><Th>flow</Th><Th right>runs</Th><Th right>avg</Th><Th right>p95</Th><Th right>spend</Th><Th>share</Th></tr>
        </thead>
        <tbody>
          {rows.map((f) => (
            <tr key={f.flow} className="border-b border-zinc-800/60 last:border-0">
              <Td>
                <span className="font-semibold text-amber-400">{f.flow}</span>
                {f.errors > 0 && <Badge tone="red" className="ml-1.5">{f.errors} err</Badge>}
              </Td>
              <Td num>{f.runs.toLocaleString()}</Td>
              <Td num>{ms(f.avg_ms)}</Td>
              <Td num>{ms(f.p95_ms)}</Td>
              <Td num className="font-semibold">{f.cost_usd == null ? <span className="text-zinc-600">—</span> : m(f.cost_usd)}</Td>
              <Td>{f.cost_usd == null ? null : <ShareCell value={f.cost_usd} max={max} />}</Td>
            </tr>
          ))}
        </tbody>
      </table>
      {!costAvailable && (
        <div className="border-t border-zinc-800 px-4 py-2 text-[11px] text-amber-400">
          Per-flow spend needs the current flows build: a flow's own cost lives in its step records, which the row-reading fallback doesn't load.
        </div>
      )}
      <div className="border-t border-zinc-800 px-4 py-2 text-[11px] text-zinc-500">
        A flow is charged for its <strong>own</strong> steps only. <code className="text-zinc-400">respond</code> and{" "}
        <code className="text-zinc-400">ingest</code> read $0 because they buffer and delegate — the money is spent by the
        flows that generate the answer.
      </div>
    </>
  );
}

function RestaurantTable({ rows, m }: { rows: Rollup["by_restaurant"]; m: (u: number, d?: number) => string }) {
  const max = Math.max(1e-9, ...rows.map((r) => r.cost_usd));
  return (
    <table className="w-full text-xs">
      <thead className="text-zinc-500">
        <tr className="border-b border-zinc-800"><Th>restaurant</Th><Th right>runs</Th><Th right>convos</Th><Th right>avg</Th><Th right>p95</Th><Th right>spend</Th><Th>share</Th><Th>last activity</Th></tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.restaurant} className="border-b border-zinc-800/60 last:border-0">
            <Td>
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-zinc-200">{r.name || r.restaurant}</span>
                {!r.readable && <Badge tone="red" title={r.reason || ""}>unreadable</Badge>}
                {r.errors > 0 && <Badge tone="red">{r.errors} err</Badge>}
              </div>
            </Td>
            <Td num>{r.runs.toLocaleString()}</Td>
            <Td num>{r.sessions.toLocaleString()}</Td>
            <Td num>{ms(r.avg_ms)}</Td>
            <Td num>{ms(r.p95_ms)}</Td>
            <Td num className="font-semibold">{m(r.cost_usd)}</Td>
            <Td><ShareCell value={r.cost_usd} max={max} /></Td>
            <Td><span title={full(r.last_at)} className={r.last_at ? "text-zinc-400" : "text-zinc-600"}>{r.last_at ? ago(r.last_at) : "silent"}</span></Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ModelTable({ b, loading, m }: { b: Breakdown<ModelRow> | null; loading: boolean; m: (u: number, d?: number) => string }) {
  if (loading && !b) return <Empty text="Loading…" />;
  if (!b) return null;
  if (!b.available) return <div className="px-4 py-4 text-[11px] text-zinc-500">Unavailable: {b.reason}</div>;
  const rows = b.rows || [];
  if (!rows.length) return <Empty text="No model calls in this window." />;
  const exact = b.exact;
  const total = Math.max(1e-9, rows.reduce((s, r) => s + r.cost_usd, 0));
  return (
    <>
    <table className="w-full text-xs">
      <thead className="text-zinc-500">
        <tr className="border-b border-zinc-800"><Th>model</Th><Th right>calls</Th><Th right>tokens</Th><Th right>avg</Th><Th right>{exact ? "spend" : "share"}</Th><Th>share</Th></tr>
      </thead>
      <tbody>
        {rows.map((x) => {
          const share = (x.cost_usd / total) * 100;
          return (
            <tr key={x.model} className="border-b border-zinc-800/60 last:border-0">
              <Td><span className="font-mono text-zinc-200">{x.model}</span></Td>
              <Td num>{x.calls.toLocaleString()}</Td>
              <Td num>{tokens(x.tokens_in)}→{tokens(x.tokens_out)}</Td>
              <Td num>{ms(x.avg_ms)}</Td>
              <Td num className="font-semibold">{exact ? m(x.cost_usd) : (share < 1 ? "<1%" : `${share.toFixed(0)}%`)}</Td>
              <Td><ShareCell value={x.cost_usd} max={total} /></Td>
            </tr>
          );
        })}
      </tbody>
    </table>
    <BreakdownNote b={b} />
    </>
  );
}

/** Says which window and whether it is exact — both differ from the page's own filter. */
function BreakdownNote({ b }: { b: Breakdown<any> }) {
  const days = Math.round(b.window_hours / 24);
  return (
    <div className="border-t border-zinc-800 px-4 py-2 text-[11px] text-zinc-500">
      {b.exact ? "Exact, over every run" : `Estimated from ${(b.sampled_runs || 0).toLocaleString()} sampled runs`} in the
      last {days === 1 ? "24h" : `${days} days`}
      {b.clamped && <> — capped there deliberately: this reads every step record, and a longer window took longer than it was worth. Averages barely move week to week.</>}
    </div>
  );
}

function StepTable({ b, loading, m }: { b: Breakdown<StepRow> | null; loading: boolean; m: (u: number, d?: number) => string }) {
  const rows = b?.rows || [];
  return (
    <div className="bg-zinc-900/60">
      <div className="border-b border-zinc-800 px-4 py-2 text-xs font-semibold text-zinc-300">Slowest steps</div>
      {loading && !b ? <Empty text="Loading…" /> : !b?.available ? (
        <div className="px-4 py-4 text-[11px] text-zinc-500">Unavailable{b?.reason ? `: ${b.reason}` : ""}</div>
      ) : rows.length === 0 ? <Empty text="No step timings." /> : (
        <div className="divide-y divide-zinc-800/60">
          {rows.map((s) => (
            <div key={`${s.flow}|${s.node}`} className="flex items-center gap-2 px-4 py-1.5 text-xs">
              <span className="min-w-0 flex-1 truncate">
                <span className="text-amber-400">{s.flow}</span>
                <span className="text-zinc-600"> › </span>
                <span className="font-mono text-zinc-200">{s.node}</span>
              </span>
              {s.errors > 0 && <Badge tone="red">{s.errors}</Badge>}
              {s.cost_usd > 0 && <span className="shrink-0 tabular-nums text-zinc-500">{m(s.cost_usd)}</span>}
              <span className="shrink-0 tabular-nums text-zinc-300">{ms(s.avg_ms)}</span>
            </div>
          ))}
          <BreakdownNote b={b} />
        </div>
      )}
    </div>
  );
}

function Leaderboard({ title, rows, metric, onOpenTrace }: {
  title: string; rows: Lead[]; metric: (r: Lead) => string; onOpenTrace: (id: string) => void;
}) {
  return (
    <div className="bg-zinc-900/60">
      <div className="border-b border-zinc-800 px-4 py-2 text-xs font-semibold text-zinc-300">{title}</div>
      {rows.length === 0 ? <Empty text="Nothing in this window." /> : (
        <div className="divide-y divide-zinc-800/60">
          {rows.map((r) => (
            <button key={r.id} onClick={() => onOpenTrace(r.id)}
              className="flex w-full items-center gap-2 px-4 py-1.5 text-left text-xs transition hover:bg-zinc-900">
              <span className="shrink-0 font-semibold text-amber-400">{r.flow}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-zinc-500">{r.session_id}</span>
              <span className="shrink-0 tabular-nums text-zinc-300">{metric(r)}</span>
              <ExternalLink size={11} className="shrink-0 text-zinc-600" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Th({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return <th className={`px-3 py-2 text-[11px] font-medium uppercase tracking-wide ${right ? "text-right" : "text-left"}`}>{children}</th>;
}
function Td({ children, num, className = "" }: { children?: React.ReactNode; num?: boolean; className?: string }) {
  return <td className={`px-3 py-1.5 ${num ? "text-right tabular-nums text-zinc-300" : ""} ${className}`}>{children}</td>;
}
