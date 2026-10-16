import { useEffect, useMemo, useRef, useState } from "react";
import {
  MessageCircle, Globe, Timer, Zap, Filter, MessageSquare, Shield, History,
  GitBranch, Send, UserPlus, Brain, Route, Database, Sparkles, Box, ChevronRight,
  ChevronDown, Copy, Check, CircleSlash, CheckCircle2, XCircle, CircleDashed,
} from "lucide-react";
import { Badge, ms as fmtMs, usd, tokens } from "./ui";

export type ExecNode = {
  name: string; status: string; ms: number;
  tokens_in: number; tokens_out: number; tokens_cached?: number; cost_usd: number;
  model: string | null; error: string | null;
  input?: string | null; output?: string | null;
};
export type Execution = {
  id: string; flow: string; session_id: string; trigger: string; status: string;
  restaurant?: string | null; parent_id?: string | null;
  is_test?: boolean;   // our own traffic (suite, harness, ops Test Chat, fixture phones)
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

/** The whole run as markdown — for pasting into a bug report or a chat with Claude. */
export function traceToMarkdown(e: Execution) {
  const head = [
    `# ${e.flow} · ${e.status}`,
    `- id: ${e.id}`,
    e.restaurant ? `- restaurant: ${e.restaurant}` : "",
    `- session: ${e.session_id}`,
    `- trigger: ${e.trigger}`,
    `- started: ${e.started_at}`,
    `- duration: ${e.duration_ms ?? "?"}ms · tokens ${e.tokens_in}→${e.tokens_out} · $${(e.cost_usd || 0).toFixed(5)}`,
    e.error ? `- error: ${e.error}` : "",
  ].filter(Boolean).join("\n");

  const body = (e.nodes || []).map((n) => [
    `\n## ${n.name} — ${n.status} · ${n.ms}ms${n.model ? ` · ${n.model}` : ""}${n.cost_usd ? ` · $${n.cost_usd.toFixed(5)}` : ""}`,
    n.error ? `\n**error:** ${n.error}` : "",
    n.input ? `\n**input**\n\`\`\`json\n${n.input}\n\`\`\`` : "",
    n.output ? `\n**output**\n\`\`\`json\n${n.output}\n\`\`\`` : "",
  ].filter(Boolean).join("\n")).join("\n");

  const kids = (e.children || []).length
    ? `\n## sub-flows\n${e.children.map((c) => `- ${c.flow} (${c.execution_id})${c.node ? ` from ${c.node}` : ""}`).join("\n")}`
    : "";

  return `${head}\n${body}${kids}\n`;
}

type Step = {
  id: string; label: string; icon: string;
  node: ExecNode | null;      // null = declared by the flow but never ran
  offset: number; span: number;
  undeclared: boolean;
};

/**
 * A run as a timeline, not a diagram: every step visible at once on the left,
 * the selected step's payload filling the right.
 *
 * The old horizontal node chain scrolled sideways past the 4th step, wrapped long
 * labels to three lines, and left the whole lower half of the pane empty until you
 * clicked something.
 */
export function TraceView({
  def, execution, onOpenChild, onJumpToRespond,
}: {
  def: FlowDef;
  execution: Execution | null;
  onOpenChild?: (executionId: string) => void;
  onJumpToRespond?: (sessionId: string, after: string) => void;
}) {
  const steps = useMemo<Step[]>(() => {
    const declared = new Map(def.nodes.map((n) => [n.id, n]));
    const ran = execution?.nodes || [];
    // recorded order IS run order (the engine pushes each node as it starts), so the
    // list reads exactly as the run happened — including steps the flow def never declared
    let cursor = 0;
    const out: Step[] = ran.map((n) => {
      const d = declared.get(n.name);
      const s: Step = {
        id: n.name, label: d?.label || n.name, icon: d?.icon || "box",
        node: n, offset: cursor, span: n.ms || 0, undeclared: !d,
      };
      cursor += n.ms || 0;
      return s;
    });
    // declared-but-never-ran, so a skipped branch is visible rather than absent
    for (const d of def.nodes) {
      if (ran.some((n) => n.name === d.id)) continue;
      out.push({ id: d.id, label: d.label, icon: d.icon, node: null, offset: 0, span: 0, undeclared: false });
    }
    return out;
  }, [def, execution]);

  // no per-node timestamps exist, so the scale is the summed step time (or the run's
  // wall clock when that's longer — the gap is engine overhead, not a step)
  const scale = Math.max(1, steps.reduce((s, x) => s + x.span, 0), execution?.duration_ms || 0);

  const [selected, setSelected] = useState<string | null>(null);
  // Land on what you'd look at first: the failure, else the expensive LLM step. Keyed on
  // the execution ID ONLY — `steps` is rebuilt whenever the flow list refreshes (every
  // 15s), and depending on it meant the step you were reading was silently swapped for
  // the auto-pick on every poll.
  const autoPicked = useRef<string | null>(null);
  useEffect(() => {
    const execId = execution?.id || null;
    if (autoPicked.current === execId) return;
    autoPicked.current = execId;
    const ran = steps.filter((s) => s.node);
    const pick = ran.find((s) => s.node!.status === "error")
      || ran.filter((s) => s.node!.model).sort((a, b) => (b.node!.cost_usd || 0) - (a.node!.cost_usd || 0))[0]
      || ran[0];
    setSelected(pick?.id || null);
  }, [execution?.id]);   // deliberately not `steps` — see above

  const step = steps.find((s) => s.id === selected) || null;
  const TriggerIcon = ICONS[def.trigger?.icon] || Zap;
  const kidsOf = (id: string) => (execution?.children || []).filter((c) => c.node === id);
  const orphanKids = (execution?.children || []).filter((c) => !c.node || !steps.some((s) => s.id === c.node));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
      {/* ---------- timeline ---------- */}
      <div className="flex min-h-0 shrink-0 flex-col overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-900/40 lg:w-[22rem]">
        <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
          <TriggerIcon size={13} className={def.trigger?.icon === "whatsapp" ? "text-emerald-400" : "text-sky-400"} />
          <span className="truncate text-[11px] text-zinc-400" title={def.trigger?.label}>{def.trigger?.label || "trigger"}</span>
          <span className="ml-auto shrink-0 text-[10px] tabular-nums text-zinc-500">{steps.filter((s) => s.node).length} steps</span>
        </div>

        <div className="p-1.5">
          {steps.map((s) => {
            const n = s.node;
            const Icon = ICONS[s.icon] || Box;
            const active = selected === s.id;
            const err = n?.status === "error";
            return (
              <div key={s.id}>
                <button
                  onClick={() => setSelected(s.id)}
                  className={`w-full rounded-xl border px-2.5 py-2 text-left transition ${
                    active ? "border-amber-500/60 bg-amber-500/5"
                    : err ? "border-red-500/40 hover:bg-zinc-900"
                    : "border-transparent hover:border-zinc-700 hover:bg-zinc-900"
                  } ${!n ? "opacity-40" : ""}`}
                >
                  <div className="flex items-center gap-1.5">
                    <StepIcon status={n?.status} />
                    <Icon size={12} className={err ? "text-red-400" : n ? "text-amber-400/80" : "text-zinc-600"} />
                    <span className="min-w-0 flex-1 truncate text-xs font-medium" title={s.label}>{s.label}</span>
                    <span className="shrink-0 text-[10px] tabular-nums text-zinc-400">
                      {n ? fmtMs(n.ms) : "skipped"}
                    </span>
                  </div>

                  {n && (
                    <>
                      {/* waterfall: width = this step's share of the run */}
                      <div className="relative mt-1.5 h-1 w-full overflow-hidden rounded-full bg-zinc-800">
                        <div
                          className={`absolute h-full rounded-full ${err ? "bg-red-500" : "bg-amber-500/70"}`}
                          style={{ left: `${(s.offset / scale) * 100}%`, width: `${Math.max(1.5, (s.span / scale) * 100)}%` }}
                        />
                      </div>
                      {(n.model || n.cost_usd > 0) && (
                        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-zinc-500">
                          {n.model && <span className="truncate">{n.model}</span>}
                          {n.cost_usd > 0 && <span className="ml-auto shrink-0 tabular-nums">{usd(n.cost_usd)}</span>}
                        </div>
                      )}
                      {err && n.error && <div className="mt-1 truncate text-[10px] text-red-400" title={n.error}>{n.error}</div>}
                    </>
                  )}
                </button>

                {/* the sub-flow this step spawned, right where it happened */}
                {kidsOf(s.id).map((c) => (
                  <button
                    key={c.execution_id}
                    onClick={() => onOpenChild?.(c.execution_id)}
                    className="ml-6 mt-0.5 flex items-center gap-1 rounded-lg border border-zinc-700 px-2 py-0.5 text-[10px] text-amber-300 transition hover:border-amber-500"
                  >
                    <GitBranch size={10} /> {c.flow} <ChevronRight size={10} />
                  </button>
                ))}
              </div>
            );
          })}

          {orphanKids.length > 0 && (
            <div className="mt-2 border-t border-zinc-800 px-1 pt-2">
              <div className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">sub-flows</div>
              <div className="flex flex-wrap gap-1">
                {orphanKids.map((c) => (
                  <button
                    key={c.execution_id}
                    onClick={() => onOpenChild?.(c.execution_id)}
                    className="flex items-center gap-1 rounded-lg border border-zinc-700 px-2 py-0.5 text-[10px] text-amber-300 transition hover:border-amber-500"
                  >
                    {c.flow} <ChevronRight size={10} />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ---------- payload ---------- */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-900/40">
        {!step ? (
          <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">Pick a step.</div>
        ) : !step.node ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-zinc-500">
            <CircleSlash size={22} className="text-zinc-700" />
            <span><span className="text-zinc-300">{step.label}</span> didn't run in this execution.</span>
          </div>
        ) : (
          <>
            <div className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-900/95 px-4 py-2.5 backdrop-blur">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">{step.label}</span>
                {step.undeclared && <Badge title="recorded by the run but not declared in the flow definition">undeclared</Badge>}
                {step.node.model && <Badge tone="amber">{step.node.model}</Badge>}
                <Badge tone={step.node.status === "error" ? "red" : "emerald"}>{step.node.status}</Badge>
                <span className="ml-auto text-xs tabular-nums text-zinc-500">
                  {fmtMs(step.node.ms)}
                  {(step.node.tokens_in || step.node.tokens_out) ? ` · ${tokens(step.node.tokens_in)}→${tokens(step.node.tokens_out)} tok` : ""}
                  {step.node.tokens_cached ? ` · ${tokens(step.node.tokens_cached)} cached` : ""}
                  {step.node.cost_usd > 0 ? ` · ${usd(step.node.cost_usd)}` : ""}
                </span>
              </div>

              {(kidsOf(step.id).length > 0 || (def.name === "ingest" && step.id === "buffer_push" && execution && onJumpToRespond)) && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {kidsOf(step.id).map((c) => (
                    <button
                      key={c.execution_id}
                      onClick={() => onOpenChild?.(c.execution_id)}
                      className="flex items-center gap-1.5 rounded-lg border border-amber-500/50 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-300 transition hover:bg-amber-500/20"
                    >
                      Open {c.flow} execution <ChevronRight size={12} />
                    </button>
                  ))}
                  {def.name === "ingest" && step.id === "buffer_push" && execution && onJumpToRespond && (
                    <button
                      onClick={() => onJumpToRespond(execution.session_id, execution.started_at)}
                      className="flex items-center gap-1.5 rounded-lg border border-sky-500/50 bg-sky-500/10 px-2.5 py-1 text-[11px] font-semibold text-sky-300 transition hover:bg-sky-500/20"
                    >
                      Find the RESPOND run for this burst <ChevronRight size={12} />
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-3 p-4">
              {step.node.error && (
                <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-300">{step.node.error}</div>
              )}
              <IoBlock title="INPUT" body={step.node.input} />
              <IoBlock title="OUTPUT" body={step.node.output} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StepIcon({ status }: { status?: string }) {
  if (status === "ok") return <CheckCircle2 size={12} className="shrink-0 text-emerald-400" />;
  if (status === "error") return <XCircle size={12} className="shrink-0 text-red-400" />;
  if (status === "running") return <CircleDashed size={12} className="shrink-0 animate-spin text-amber-400" />;
  return <CircleSlash size={12} className="shrink-0 text-zinc-600" />;
}

// ---------- payload rendering ----------

type Chat = { role: string; content: string }[];

/** LLM payloads are the ones worth reading; everything else is just JSON. */
function asChat(v: any): Chat | null {
  const arr = Array.isArray(v) ? v : Array.isArray(v?.messages) ? v.messages : null;
  if (!arr?.length) return null;
  const out: Chat = [];
  for (const m of arr) {
    if (!m || typeof m !== "object" || typeof m.role !== "string") return null;
    const c = m.content;
    out.push({
      role: m.role,
      content: typeof c === "string" ? c
        : Array.isArray(c) ? c.map((p: any) => (typeof p === "string" ? p : p?.text || JSON.stringify(p))).join("\n")
        : JSON.stringify(c, null, 1),
    });
  }
  return out;
}

function tryParse(body?: string | null) {
  if (!body) return undefined;
  const s = body.trim();
  if (!s.startsWith("{") && !s.startsWith("[")) return undefined;
  try { return JSON.parse(s); } catch { return undefined; } // truncated snapshots stay raw
}

function IoBlock({ title, body }: { title: string; body?: string | null }) {
  const parsed = useMemo(() => tryParse(body), [body]);
  const chat = useMemo(() => (parsed !== undefined ? asChat(parsed) : null), [parsed]);
  const [view, setView] = useState<"auto" | "raw">("auto");
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(body || "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch { /* non-secure origin or denied permission — silently no-op, never throw */ }
  }

  const pretty = view === "auto" && parsed !== undefined;

  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{title}</span>
        {chat && pretty && <Badge tone="amber">{chat.length} messages</Badge>}
        {body && <span className="text-[10px] text-zinc-600">{body.length.toLocaleString()} chars</span>}
        <div className="ml-auto flex items-center gap-1.5">
          {parsed !== undefined && (
            <button onClick={() => setView(view === "auto" ? "raw" : "auto")}
              className="text-[10px] text-zinc-500 transition hover:text-amber-400">
              {view === "auto" ? "raw" : "pretty"}
            </button>
          )}
          {body && (
            <button onClick={copy} className="text-zinc-500 transition hover:text-amber-400" title="Copy">
              {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
            </button>
          )}
        </div>
      </div>
      <div className="overflow-auto rounded-xl bg-zinc-950 p-3">
        {!body ? (
          <span className="font-mono text-[11px] text-zinc-600">—</span>
        ) : pretty && chat ? (
          <ChatPayload chat={chat} />
        ) : pretty ? (
          <JsonNode value={parsed} depth={0} />
        ) : (
          <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-zinc-300">{body}</pre>
        )}
      </div>
    </div>
  );
}

const ROLE_TONE: Record<string, string> = {
  system: "border-zinc-700 text-zinc-400",
  user: "border-sky-500/40 text-sky-200",
  human: "border-sky-500/40 text-sky-200",
  assistant: "border-amber-500/40 text-amber-100",
  ai: "border-amber-500/40 text-amber-100",
  tool: "border-emerald-500/40 text-emerald-200",
};

function ChatPayload({ chat }: { chat: Chat }) {
  return (
    <div className="space-y-2">
      {chat.map((m, i) => <ChatBubble key={i} role={m.role} content={m.content} />)}
    </div>
  );
}

function ChatBubble({ role, content }: { role: string; content: string }) {
  // system prompts run to thousands of characters — collapsed by default so the
  // actual conversation is what you see first
  const long = content.length > 700;
  const [open, setOpen] = useState(!long || role !== "system");
  const tone = ROLE_TONE[role.toLowerCase()] || "border-zinc-700 text-zinc-300";
  return (
    <div className={`rounded-lg border-l-2 bg-zinc-900/60 px-2.5 py-1.5 ${tone}`}>
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-1.5 text-left">
        <span className="text-[9px] font-bold uppercase tracking-wider opacity-70">{role}</span>
        <span className="text-[9px] text-zinc-600">{content.length} chars</span>
        {long && <span className="ml-auto text-[9px] text-zinc-500">{open ? "collapse" : "expand"}</span>}
      </button>
      <pre className={`mt-1 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed ${open ? "" : "line-clamp-2"}`}>
        {content}
      </pre>
    </div>
  );
}

function JsonNode({ k, value, depth }: { k?: string; value: any; depth: number }) {
  const isObj = value !== null && typeof value === "object";
  const [open, setOpen] = useState(depth < 2);
  const pad = { paddingLeft: depth ? 12 : 0 };

  if (!isObj) {
    return (
      <div style={pad} className="font-mono text-[11px] leading-relaxed">
        {k !== undefined && <span className="text-sky-300">{k}</span>}
        {k !== undefined && <span className="text-zinc-600">: </span>}
        <Scalar v={value} />
      </div>
    );
  }

  const entries: [string, any][] = Array.isArray(value)
    ? value.map((v, i) => [String(i), v])
    : Object.entries(value);
  const label = Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`;

  return (
    <div style={pad}>
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-1 font-mono text-[11px] text-zinc-400 hover:text-amber-400">
        {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        {k !== undefined && <span className="text-sky-300">{k}</span>}
        <span className="text-zinc-600">{label}</span>
      </button>
      {open && (
        <div className="border-l border-zinc-800 pl-1">
          {entries.map(([ek, ev]) => <JsonNode key={ek} k={ek} value={ev} depth={depth + 1} />)}
        </div>
      )}
    </div>
  );
}

function Scalar({ v }: { v: any }) {
  const [open, setOpen] = useState(false);
  if (v === null) return <span className="text-zinc-600">null</span>;
  if (typeof v === "boolean") return <span className="text-violet-300">{String(v)}</span>;
  if (typeof v === "number") return <span className="text-emerald-300 tabular-nums">{v}</span>;
  const s = String(v);
  if (s.length <= 180) return <span className="whitespace-pre-wrap break-words text-zinc-300">{s}</span>;
  return (
    <span onClick={() => setOpen((o) => !o)} className="cursor-pointer whitespace-pre-wrap break-words text-zinc-300">
      {open ? s : `${s.slice(0, 180)}…`}
      <span className="ml-1 text-[9px] text-zinc-600">{open ? "less" : `+${s.length - 180}`}</span>
    </span>
  );
}
