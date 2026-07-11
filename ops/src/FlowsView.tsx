import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, CircleDashed, Workflow } from "lucide-react";
import { ops } from "./config";
import { Card, Empty } from "./ui";
import { FlowCanvas, type FlowDef, type Execution } from "./FlowCanvas";

type FlowStats = FlowDef & { runs: number; ok: number; errors: number; cost_usd: number; avg_ms: number };

type Metrics = {
  messages_in: number; bursts: number; merge_ratio: number; avg_window_ms: number;
  spam_blocks: number; faq_hits: number; closer_hits: number; llm_replies: number;
  zero_llm_rate: number; dead_letters: number;
};

export default function FlowsView() {
  const [flows, setFlows] = useState<FlowStats[]>([]);
  const [selectedFlow, setSelectedFlow] = useState<string | null>(null);
  const [execs, setExecs] = useState<Execution[]>([]);
  const [execution, setExecution] = useState<Execution | null>(null);
  const [offline, setOffline] = useState(false);
  const [m, setM] = useState<Metrics | null>(null);

  useEffect(() => {
    const load = () =>
      ops.get("/api/flows").then((r) => {
        setFlows(r.data);
        setOffline(false);
        if (!selectedFlow && r.data.length) setSelectedFlow(r.data[0].name);
      }).catch(() => setOffline(true));
    const loadMetrics = () => ops.get("/api/metrics").then((r) => setM(r.data)).catch(() => {});
    load();
    loadMetrics();
    const t = setInterval(() => { load(); loadMetrics(); }, 10000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!selectedFlow) return;
    setExecution(null);
    const load = () =>
      ops.get("/api/executions", { params: { flow: selectedFlow, limit: 30 } }).then((r) => setExecs(r.data)).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [selectedFlow]);

  async function openExecution(id: string) {
    const { data } = await ops.get(`/api/executions/${id}`);
    // jump to the right flow canvas if it's a child of another flow
    if (data.flow !== selectedFlow) setSelectedFlow(data.flow);
    setExecution(data);
  }

  // buffer_push click-through: find the respond run that consumed this session's burst
  async function jumpToRespond(sessionId: string, after: string) {
    const { data } = await ops.get("/api/executions", { params: { flow: "respond", limit: 50 } });
    const match = (data as Execution[])
      .filter((e) => e.session_id === sessionId && e.started_at >= after)
      .sort((a, b) => (a.started_at < b.started_at ? -1 : 1))[0]
      || (data as Execution[]).find((e) => e.session_id === sessionId);
    if (match) openExecution(match.id);
  }

  const def = flows.find((f) => f.name === selectedFlow) || null;

  return (
    <div>
      <RegressionPanel />
      {m && (
        <div className="mb-5 grid grid-cols-3 gap-3 md:grid-cols-9">
          <Metric label="msgs in" value={String(m.messages_in)} />
          <Metric label="bursts" value={String(m.bursts)} />
          <Metric label="merge ratio" value={`${m.merge_ratio}×`} hint="msgs per reply — buffering saving LLM calls" />
          <Metric label="avg window" value={`${(m.avg_window_ms / 1000).toFixed(1)}s`} />
          <Metric label="0-LLM rate" value={`${m.zero_llm_rate}%`} hint="answered free by fast paths" />
          <Metric label="faq hits" value={String(m.faq_hits)} />
          <Metric label="closers" value={String(m.closer_hits)} />
          <Metric label="spam blocks" value={String(m.spam_blocks)} />
          <Metric label="dead letters" value={String(m.dead_letters)} bad={m.dead_letters > 0} />
        </div>
      )}
      <div className="grid gap-5 lg:grid-cols-6">
      {/* flow list */}
      <div className="space-y-2 lg:col-span-1">
        {offline && <Card className="p-3 text-xs text-red-300">flows service offline</Card>}
        {flows.map((fl) => (
          <Card
            key={fl.name}
            onClick={() => setSelectedFlow(fl.name)}
            className={`cursor-pointer p-3 transition hover:border-zinc-600 ${selectedFlow === fl.name ? "border-amber-500/60" : ""}`}
          >
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Workflow size={14} className="text-amber-400" /> {fl.name}
            </div>
            <div className="mt-1 text-[11px] text-zinc-500">
              {fl.runs} runs · <span className={fl.errors ? "text-red-400" : ""}>{fl.errors} err</span> · ${fl.cost_usd.toFixed(4)}
            </div>
          </Card>
        ))}
      </div>

      {/* canvas + history */}
      <div className="lg:col-span-5">
        {!def ? (
          <Card><Empty text="Select a flow" /></Card>
        ) : (
          <>
            <div className="mb-1 text-lg font-semibold">{def.name}</div>
            <div className="mb-4 text-sm text-zinc-400">{def.description}</div>
            <FlowCanvas def={def} execution={execution} onOpenChild={openExecution} onJumpToRespond={jumpToRespond} />

            <div className="mb-2 mt-6 text-sm font-semibold text-zinc-300">
              Execution history {execution && <span className="ml-2 text-xs font-normal text-amber-400">(viewing {execution.id} — click a node above)</span>}
            </div>
            {execs.length === 0 ? (
              <Card><Empty text="No executions yet" /></Card>
            ) : (
              <div className="space-y-1.5">
                {execs.map((e) => (
                  <Card
                    key={e.id}
                    onClick={() => openExecution(e.id)}
                    className={`cursor-pointer px-4 py-2.5 transition hover:border-zinc-600 ${execution?.id === e.id ? "border-amber-500/60" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <StatusIcon status={e.status} />
                        <div>
                          <div className="text-sm">
                            {e.started_at.slice(11, 19)} <span className="text-zinc-500">· {e.session_id.slice(0, 24)} · {e.trigger}</span>
                          </div>
                          {e.error && <div className="max-w-xl truncate text-xs text-red-400">{e.error}</div>}
                        </div>
                      </div>
                      <div className="text-right text-xs tabular-nums text-zinc-400">
                        <div>{e.duration_ms != null ? `${e.duration_ms}ms` : "…"}</div>
                        <div>{e.cost_usd > 0 ? `$${e.cost_usd.toFixed(5)}` : "—"}</div>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      </div>
    </div>
  );
}

function RegressionPanel() {
  const [state, setState] = useState<any>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const load = () => ops.get("/api/ops/regression").then((r) => setState(r.data)).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  async function run() {
    await ops.post("/api/ops/run-regression");
    setOpen(true);
    setState((s: any) => ({ ...(s || {}), status: "running" }));
  }

  const running = state?.status === "running";
  const done = state?.status === "done";
  return (
    <div className="mb-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold">🧪 Regression suite</span>
          {running && <span className="animate-pulse text-xs text-amber-400">running… ({state?.results?.length || 0}/20)</span>}
          {done && (
            <button onClick={() => setOpen((v) => !v)} className={`text-xs font-semibold ${state.failed ? "text-red-400" : "text-emerald-400"}`}>
              {state.passed}/{state.passed + state.failed} passed {state.failed ? "❌" : "✅"} — {open ? "hide" : "details"}
            </button>
          )}
          {!running && !done && <span className="text-xs text-zinc-500">20 cases through the real pipeline (~1 min, ~$0.01)</span>}
        </div>
        <button onClick={run} disabled={running} className="rounded-xl bg-amber-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:opacity-40">
          Run
        </button>
      </div>
      {open && done && (
        <div className="mt-3 grid gap-1.5 md:grid-cols-2">
          {state.results.map((r: any) => (
            <div key={r.id} className={`rounded-lg border px-3 py-2 text-xs ${r.pass ? "border-zinc-800 bg-zinc-900" : "border-red-500/50 bg-red-500/10"}`}>
              <div className="font-medium">{r.pass ? "✅" : "❌"} {r.name}</div>
              {!r.pass && <div className="mt-0.5 text-red-300">{r.failures?.join("; ")}</div>}
              {!r.pass && r.reply && <div className="mt-0.5 text-zinc-400">reply: {r.reply.slice(0, 120)}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, hint, bad }: { label: string; value: string; hint?: string; bad?: boolean }) {
  return (
    <div title={hint} className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-center">
      <div className={`text-sm font-semibold tabular-nums ${bad ? "text-red-400" : ""}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
    </div>
  );
}

export function StatusIcon({ status, small }: { status: string; small?: boolean }) {
  const size = small ? 13 : 16;
  if (status === "ok") return <CheckCircle2 size={size} className="text-emerald-400" />;
  if (status === "error") return <XCircle size={size} className="text-red-400" />;
  return <CircleDashed size={size} className="animate-spin text-amber-400" />;
}
