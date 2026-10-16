import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, RefreshCw, ExternalLink } from "lucide-react";
import { ops } from "./config";
import { Card, Btn, Empty, Badge, Segments, Select, Stat, ago, full } from "./ui";

type NodeErr = { node: string; error: string; ms: number | null; model: string | null };
type Group = { key: string; flow: string; node: string | null; error: string; count: number; last_at: string; fatal: boolean };
type Failure = {
  id: string; flow: string; session_id: string | null; trigger: string | null; restaurant?: string | null;
  at: string; duration_ms: number | null; fatal: boolean; error: string; nodes: NodeErr[];
  is_test?: boolean;
};
type Report = {
  available: boolean; reason?: string; window_hours?: number;
  runs: number; failed_runs?: number; error_rate?: number;
  capped?: boolean; degraded?: string | null;
  groups: Group[]; recent: Failure[];
};

const WINDOWS: [string, string][] = [["1", "1h"], ["6", "6h"], ["24", "24h"], ["168", "7 days"]];

export default function HealthView({ onOpenTrace }: { onOpenTrace: (id: string) => void }) {
  const [data, setData] = useState<Report | null>(null);
  const [hours, setHours] = useState("24");
  const [open, setOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [restaurant, setRestaurant] = useState("");
  const [kind, setKind] = useState<"all" | "fatal" | "recovered">("all");
  // Failures are dominated by our own traffic (the suite alone is ~700 runs a pass), so a
  // real guest's error was buried in hundreds of ours. Real is the default here too.
  const [traffic, setTraffic] = useState<"real" | "test" | "all">("real");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = () => {
      setLoading(true);
      ops.get(`/api/ops/health?hours=${hours}`)
        .then((r) => alive && setData(r.data))
        .catch((e) => alive && setData({ available: false, reason: e?.message || "request failed", runs: 0, groups: [], recent: [] }))
        .finally(() => alive && setLoading(false));
    };
    load();
    const t = setInterval(load, 30000);
    return () => { alive = false; clearInterval(t); };
  }, [hours, tick]);

  const recent = data?.recent || [];
  const restaurants = useMemo(
    () => [...new Set(recent.map((r) => r.restaurant).filter(Boolean))].sort() as string[],
    [recent]
  );

  // the grouped rollup is server-side and has no restaurant on it, so the
  // restaurant filter narrows the failures and the groups are recomputed here
  // memoised: a fresh array each render meant the grouping below re-ran every time
  const failures = useMemo(() => recent.filter((r) =>
    (!restaurant || r.restaurant === restaurant) &&
    (kind === "all" || (kind === "fatal" ? r.fatal : !r.fatal)) &&
    (traffic === "all" || (traffic === "test" ? r.is_test : !r.is_test))
  ), [recent, restaurant, kind, traffic]);
  const groups = useMemo(() => {
    // the server groups everything; any client filter means regrouping from `failures`
    if (!restaurant && kind === "all" && traffic === "all") return data?.groups || [];
    const m = new Map<string, Group>();
    for (const f of failures) {
      const key = `${f.flow}|${f.nodes[0]?.node || "-"}|${f.error.slice(0, 120)}`;
      const g = m.get(key);
      if (g) { g.count++; if (f.at > g.last_at) g.last_at = f.at; }
      else m.set(key, { key, flow: f.flow, node: f.nodes[0]?.node || null, error: f.error, count: 1, last_at: f.at, fatal: f.fatal });
    }
    return [...m.values()].sort((a, b) => b.count - a.count || (a.last_at < b.last_at ? 1 : -1));
  }, [data, failures, restaurant, kind, traffic]);

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div>
          <h2 className="text-lg font-bold">Health</h2>
          <p className="text-sm text-zinc-400">
            {data?.available
              ? `${data.failed_runs} failed of ${data.runs} agent runs in the last ${data.window_hours}h · ${data.error_rate}% error rate`
              : "Where the agents are breaking"}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Segments value={traffic} onChange={setTraffic} options={[["real", "Real"], ["test", "Test"], ["all", "All"]]} />
          <Segments value={kind} onChange={setKind} options={[["all", "All"], ["fatal", "Failed"], ["recovered", "Recovered"]]} />
          {/* rendered whenever a filter is set, even if this window now has one restaurant
              or none — hiding it stranded the filter with no way to clear it */}
          {(restaurants.length > 1 || restaurant) && (
            <Select value={restaurant} onChange={setRestaurant}
              options={[["", "all restaurants"], ...new Set([...restaurants, ...(restaurant ? [restaurant] : [])])]
                .map((r) => (Array.isArray(r) ? r : [r, r]) as [string, string])} />
          )}
          <Segments value={hours} onChange={setHours} options={WINDOWS} />
          <Btn variant="ghost" onClick={() => setTick((t) => t + 1)}>
            <span className="flex items-center gap-1.5">
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
            </span>
          </Btn>
        </div>
      </div>

      {data?.available && (
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="runs" value={String(data.runs)} sub={`last ${data.window_hours}h`} />
          <Stat label={traffic === "all" ? "failed runs" : `failed (${traffic})`} value={failures.length.toLocaleString()}
            bad={failures.length > 0} sub={traffic !== "all" ? `${(data.failed_runs ?? 0).toLocaleString()} incl. ours` : undefined} />
          <Stat label="error rate" value={`${data.error_rate ?? 0}%`} bad={(data.error_rate ?? 0) > 2} />
          <Stat label="distinct problems" value={String(groups.length)} bad={groups.length > 0} />
        </div>
      )}

      {data?.capped && (
        <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          A restaurant hit the 5,000-failure read cap in this window — the list below is a floor. Narrow the window for the full picture.
        </div>
      )}
      {data?.degraded && (
        <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          Recovered failures (a run that finished ok after a step failed) couldn't be queried, so they're missing here — only outright failures are shown. Database said: {data.degraded}
        </div>
      )}

      {!data ? null : !data.available ? (
        <Card className="p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-400" />
            <div>
              <div className="font-semibold">No execution trace to read</div>
              <p className="mt-1 text-sm text-zinc-400">
                Agents write every run to <code className="text-zinc-300">flow_executions</code>, but that table
                isn't readable in this restaurant's database. Migration 003 creates it.
              </p>
              {data.reason && <p className="mt-2 text-xs text-zinc-500">Database said: {data.reason}</p>}
            </div>
          </div>
        </Card>
      ) : groups.length === 0 ? (
        <Card className="p-5">
          <div className="flex items-center gap-3">
            <CheckCircle2 size={18} className="text-emerald-400" />
            <div>
              <div className="font-semibold">No failures</div>
              <p className="text-sm text-zinc-400">
                {restaurant || kind !== "all" || traffic !== "all"
                  ? `Nothing matches this filter${traffic === "real" ? " — no real guest hit an error" : ""}.`
                  : `All ${data.runs} agent runs in this window completed cleanly.`}
              </p>
            </div>
          </div>
        </Card>
      ) : (
        <>
          <Card className="mb-5 overflow-hidden">
            <div className="border-b border-zinc-800 px-4 py-3 text-sm font-semibold">
              What's failing ({groups.length} distinct {groups.length === 1 ? "problem" : "problems"})
            </div>
            <div className="divide-y divide-zinc-800">
              {groups.map((g) => {
                // one click from a recurring problem to a real run of it
                const sample = failures.find((f) => f.flow === g.flow && f.error === g.error);
                return (
                  <div key={g.key} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <Badge tone={g.fatal ? "red" : "amber"}>{g.fatal ? "failed" : "recovered"}</Badge>
                    <span className="font-mono text-xs text-zinc-400">
                      {g.flow}{g.node ? ` › ${g.node}` : ""}
                    </span>
                    <span className="min-w-[220px] flex-1 truncate text-sm" title={g.error}>{g.error}</span>
                    <span className="text-xs text-zinc-500" title={full(g.last_at)}>{ago(g.last_at)}</span>
                    <span className="rounded-md bg-zinc-800 px-2 py-0.5 text-xs font-semibold">×{g.count}</span>
                    {sample && (
                      <button onClick={() => onOpenTrace(sample.id)} title="Open a trace of this failure"
                        className="rounded-lg border border-zinc-700 p-1 text-zinc-400 transition hover:border-amber-500 hover:text-amber-400">
                        <ExternalLink size={12} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="border-b border-zinc-800 px-4 py-3 text-sm font-semibold">Recent failed runs</div>
            {failures.length === 0 ? (
              <Empty text="Nothing in this window." />
            ) : (
              <div className="divide-y divide-zinc-800">
                {failures.map((r) => {
                  const isOpen = open === r.id;
                  return (
                    <div key={r.id}>
                      <div className="flex w-full flex-wrap items-center gap-3 px-4 py-3 hover:bg-zinc-900">
                        <button onClick={() => setOpen(isOpen ? null : r.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                          {isOpen ? <ChevronDown size={15} className="shrink-0" /> : <ChevronRight size={15} className="shrink-0" />}
                          <span className="font-mono text-xs font-semibold text-amber-400">{r.flow}</span>
                          {traffic === "all" && r.is_test && <Badge title="our own traffic, not a guest">test</Badge>}
                          {r.restaurant && <Badge tone="sky">{r.restaurant}</Badge>}
                          <span className="min-w-[200px] flex-1 truncate text-sm" title={r.error}>{r.error}</span>
                          {r.session_id && <span className="hidden font-mono text-xs text-zinc-500 lg:inline">{r.session_id}</span>}
                          <span className="text-xs text-zinc-500" title={full(r.at)}>{ago(r.at)}</span>
                        </button>
                        <button onClick={() => onOpenTrace(r.id)} title="Open this run's trace"
                          className="flex items-center gap-1 rounded-lg border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 transition hover:border-amber-500 hover:text-amber-400">
                          Trace <ExternalLink size={11} />
                        </button>
                      </div>
                      {isOpen && (
                        <div className="bg-zinc-950/60 px-11 py-3">
                          <div className="mb-2 text-xs text-zinc-500">
                            {r.trigger ? `triggered by ${r.trigger} · ` : ""}
                            {r.duration_ms != null ? `${r.duration_ms}ms · ` : ""}
                            {full(r.at)} · <span className="font-mono">{r.id}</span>
                          </div>
                          {r.nodes.length === 0 ? (
                            <div className="text-sm text-zinc-400">The flow failed before any step ran.</div>
                          ) : (
                            r.nodes.map((n, i) => (
                              <div key={i} className="mb-2 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
                                <div className="mb-1 flex items-center gap-2 text-xs">
                                  <span className="font-semibold">Step: {n.node}</span>
                                  {n.model && <span className="text-zinc-500">{n.model}</span>}
                                  {n.ms != null && <span className="text-zinc-500">{n.ms}ms</span>}
                                </div>
                                <pre className="whitespace-pre-wrap break-words font-mono text-xs text-rose-300">{n.error}</pre>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
