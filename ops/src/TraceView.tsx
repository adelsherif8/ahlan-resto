import { useState } from "react";
import {
  MessageCircle, Globe, Timer, Zap, Filter, MessageSquare, Shield, History,
  GitBranch, Send, UserPlus, Brain, Route, Database, Sparkles, Box, ChevronRight,
} from "lucide-react";

export type ExecNode = {
  name: string; status: string; ms: number;
  tokens_in: number; tokens_out: number; cost_usd: number;
  model: string | null; error: string | null;
  input?: string | null; output?: string | null;
};
export type Execution = {
  id: string; flow: string; session_id: string; trigger: string; status: string;
  error: string | null; started_at: string; duration_ms: number | null;
  tokens_in: number; tokens_out: number; cost_usd: number;
  nodes: ExecNode[]; children: { flow: string; execution_id: string; node?: string }[];
};
export type FlowDef = {
  name: string; description: string;
  trigger: { icon: string; label: string };
  nodes: { id: string; label: string; icon: string }[];
};

const ICONS: Record<string, any> = {
  whatsapp: MessageCircle, web: Globe, timer: Timer, zap: Zap, filter: Filter,
  message: MessageSquare, shield: Shield, history: History, branch: GitBranch,
  send: Send, user: UserPlus, brain: Brain, route: Route, database: Database,
  sparkles: Sparkles, box: Box,
};

export function FlowCanvas({
  def, execution, onOpenChild, onJumpToRespond,
}: {
  def: FlowDef;
  execution: Execution | null;
  onOpenChild?: (executionId: string) => void;
  onJumpToRespond?: (sessionId: string, after: string) => void;
}) {
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  const execNode = (id: string): ExecNode | null =>
    execution?.nodes.find((n) => n.name === id) || null;

  const nodeState = (id: string) => {
    if (!execution) return "idle";
    const n = execNode(id);
    if (!n) return "skipped";
    return n.status; // ok | error | running
  };

  const ring = {
    ok: "border-emerald-500/70",
    error: "border-red-500 shadow-[0_0_16px_rgba(239,68,68,0.35)]",
    running: "border-amber-400 animate-pulse",
    skipped: "border-zinc-800 opacity-40",
    idle: "border-zinc-700",
  } as Record<string, string>;

  const selected = selectedNode ? execNode(selectedNode) : null;
  const TriggerIcon = ICONS[def.trigger?.icon] || Zap;

  return (
    <div>
      {/* canvas */}
      <div className="overflow-x-auto rounded-2xl border border-zinc-800 bg-[radial-gradient(circle,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:18px_18px] p-6">
        <div className="flex items-center gap-0">
          {/* trigger node */}
          <div className="flex min-w-32 flex-col items-center gap-1.5 rounded-2xl border-2 border-dashed border-zinc-600 bg-zinc-900/90 px-4 py-3">
            <TriggerIcon size={22} className={def.trigger?.icon === "whatsapp" ? "text-emerald-400" : "text-sky-400"} />
            <div className="max-w-36 text-center text-[11px] leading-tight text-zinc-400">{def.trigger?.label || "trigger"}</div>
          </div>
          <Connector ok={!!execution} />
          {def.nodes.map((n, i) => {
            const st = nodeState(n.id);
            const en = execNode(n.id);
            const Icon = ICONS[n.icon] || Box;
            return (
              <div key={n.id} className="flex items-center">
                <button
                  onClick={() => setSelectedNode(selectedNode === n.id ? null : n.id)}
                  className={`flex min-w-32 flex-col items-center gap-1.5 rounded-2xl border-2 bg-zinc-900/90 px-4 py-3 transition hover:scale-[1.03] ${ring[st]} ${selectedNode === n.id ? "ring-2 ring-amber-400/60" : ""}`}
                >
                  <Icon size={22} className={st === "error" ? "text-red-400" : "text-amber-400"} />
                  <div className="text-xs font-medium">{n.label}</div>
                  {en && (
                    <div className="text-[10px] tabular-nums text-zinc-500">
                      {en.ms}ms{en.cost_usd > 0 ? ` · $${en.cost_usd.toFixed(5)}` : ""}
                    </div>
                  )}
                </button>
                {i < def.nodes.length - 1 && <Connector ok={st === "ok"} error={st === "error"} />}
              </div>
            );
          })}
        </div>

        {/* sub-flow links */}
        {execution && execution.children.length > 0 && (
          <div className="mt-4 flex items-center gap-2 text-xs text-zinc-400">
            <GitBranch size={13} className="text-amber-400" />
            sub-flows:
            {execution.children.map((c) => (
              <button
                key={c.execution_id}
                onClick={() => onOpenChild?.(c.execution_id)}
                className="flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-amber-300 transition hover:border-amber-500"
              >
                {c.flow} <ChevronRight size={12} />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* node inspector */}
      {selectedNode && (
        <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold">
              {def.nodes.find((n) => n.id === selectedNode)?.label || selectedNode}
              {selected?.model && <span className="ml-2 text-xs font-normal text-zinc-500">{selected.model}</span>}
            </div>
            {selected && (
              <div className="text-xs tabular-nums text-zinc-500">
                {selected.ms}ms · {selected.tokens_in}→{selected.tokens_out} tok
                {selected.cost_usd > 0 ? ` · $${selected.cost_usd.toFixed(5)}` : ""}
              </div>
            )}
          </div>
          {!execution && <div className="text-sm text-zinc-500">Select an execution below to see this node's real input/output.</div>}
          {execution && !selected && <div className="text-sm text-zinc-500">This node didn't run in the selected execution.</div>}
          {/* click-through: this node spawned a sub-flow → open that exact execution */}
          {execution && selectedNode && execution.children.filter((c) => c.node === selectedNode).map((c) => (
            <button
              key={c.execution_id}
              onClick={() => onOpenChild?.(c.execution_id)}
              className="mb-3 mr-2 flex items-center gap-1.5 rounded-xl border border-amber-500/50 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-300 transition hover:bg-amber-500/20"
            >
              Open {c.flow} execution <ChevronRight size={13} />
            </button>
          ))}
          {/* ingest → find the respond run this burst became */}
          {execution && def.name === "ingest" && selectedNode === "buffer_push" && onJumpToRespond && (
            <button
              onClick={() => onJumpToRespond(execution.session_id, execution.started_at)}
              className="mb-3 flex items-center gap-1.5 rounded-xl border border-sky-500/50 bg-sky-500/10 px-3 py-1.5 text-xs font-semibold text-sky-300 transition hover:bg-sky-500/20"
            >
              → Find the RESPOND run for this burst <ChevronRight size={13} />
            </button>
          )}
          {selected?.error && (
            <div className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-300">{selected.error}</div>
          )}
          {selected && (
            <div className="grid gap-3 lg:grid-cols-2">
              <IoBlock title="INPUT" body={selected.input} />
              <IoBlock title="OUTPUT" body={selected.output} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Connector({ ok, error }: { ok?: boolean; error?: boolean }) {
  return (
    <div className="flex w-10 items-center">
      <div className={`h-0.5 w-full ${error ? "bg-red-500" : ok ? "bg-emerald-500/70" : "bg-zinc-700"}`} />
      <div className={`-ml-1 h-0 w-0 border-y-4 border-l-6 border-y-transparent ${error ? "border-l-red-500" : ok ? "border-l-emerald-500/70" : "border-l-zinc-700"}`} />
    </div>
  );
}

function IoBlock({ title, body }: { title: string; body?: string | null }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{title}</div>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-zinc-950 p-3 font-mono text-[11px] leading-relaxed text-zinc-300">
        {body || "—"}
      </pre>
    </div>
  );
}
