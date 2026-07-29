import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { ops } from "./config";
import { Card, Btn, Empty } from "./ui";

type NodeErr = { node: string; error: string; ms: number | null; model: string | null };
type Group = { key: string; flow: string; node: string | null; error: string; count: number; last_at: string; fatal: boolean };
type Failure = {
  id: string; flow: string; session_id: string | null; trigger: string | null;
  at: string; duration_ms: number | null; fatal: boolean; error: string; nodes: NodeErr[];
};
type Report = {
  available: boolean; reason?: string; window_hours?: number;
  runs: number; failed_runs?: number; error_rate?: number;
  groups: Group[]; recent: Failure[];
};

const WINDOWS = [1, 6, 24, 168];

function ago(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

export default function HealthView() {
  const [data, setData] = useState<Report | null>(null);
  const [hours, setHours] = useState(24);
  const [open, setOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
  }, [hours]);

  const groups = data?.groups || [];
  const recent = data?.recent || [];

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div>
          <h2 className="text-lg font-bold">Health</h2>
          <p className="text-sm text-zinc-400">
            {data?.available
              ? `${data.failed_runs} failed of ${data.runs} agent runs in the last ${data.window_hours}h · ${data.error_rate}% error rate`
              : "Where the agents are breaking"}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {WINDOWS.map((h) => (
            <button
              key={h}
              onClick={() => setHours(h)}
              className={`rounded-lg px-3 py-1.5 text-sm transition ${
                hours === h ? "bg-amber-500/10 font-semibold text-amber-400" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
              }`}
            >
              {h === 168 ? "7 days" : `${h}h`}
            </button>
          ))}
          <Btn variant="ghost" onClick={() => setHours((h) => h)}>
            <span className="flex items-center gap-1.5">
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
            </span>
          </Btn>
        </div>
      </div>

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
              <p className="text-sm text-zinc-400">All {data.runs} agent runs in this window completed cleanly.</p>
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
              {groups.map((g) => (
                <div key={g.key} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      g.fatal ? "bg-red-500/15 text-red-300" : "bg-amber-500/15 text-amber-300"
                    }`}
                  >
                    {g.fatal ? "failed" : "recovered"}
                  </span>
                  <span className="font-mono text-xs text-zinc-400">
                    {g.flow}{g.node ? ` › ${g.node}` : ""}
                  </span>
                  <span className="min-w-[220px] flex-1 truncate text-sm" title={g.error}>{g.error}</span>
                  <span className="text-xs text-zinc-500">{ago(g.last_at)}</span>
                  <span className="rounded-md bg-zinc-800 px-2 py-0.5 text-xs font-semibold">×{g.count}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="border-b border-zinc-800 px-4 py-3 text-sm font-semibold">Recent failed runs</div>
            {recent.length === 0 ? (
              <Empty text="Nothing in this window." />
            ) : (
              <div className="divide-y divide-zinc-800">
                {recent.map((r) => {
                  const isOpen = open === r.id;
                  return (
                    <div key={r.id}>
                      <button
                        onClick={() => setOpen(isOpen ? null : r.id)}
                        className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-zinc-900"
                      >
                        {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                        <span className="font-mono text-xs font-semibold text-amber-400">{r.flow}</span>
                        <span className="min-w-[220px] flex-1 truncate text-sm" title={r.error}>{r.error}</span>
                        {r.session_id && <span className="font-mono text-xs text-zinc-500">{r.session_id}</span>}
                        <span className="text-xs text-zinc-500">{ago(r.at)}</span>
                      </button>
                      {isOpen && (
                        <div className="bg-zinc-950/60 px-11 py-3">
                          <div className="mb-2 text-xs text-zinc-500">
                            {r.trigger ? `triggered by ${r.trigger} · ` : ""}
                            {r.duration_ms != null ? `${r.duration_ms}ms · ` : ""}
                            {new Date(r.at).toLocaleString()} · <span className="font-mono">{r.id}</span>
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
