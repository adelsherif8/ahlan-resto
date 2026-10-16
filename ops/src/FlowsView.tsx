import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2, XCircle, CircleDashed, Workflow, Search, X, Copy, Check,
  ChevronRight, ChevronDown, Layers, BarChart3, FlaskConical, Play, Pause, CornerDownRight, Zap, RotateCcw, DollarSign,
} from "lucide-react";
import { ops } from "./config";
import { Card, Empty, Select, Segments, Badge, LiveDot, ago, clock, full, ms, usd, tokens } from "./ui";
import { TraceView, traceToMarkdown, type FlowDef, type Execution } from "./TraceView";
import type { UrlState } from "./urlstate";
import { usePageVisible, useDebounced, useFirstSeen } from "./hooks";

type Bucket = {
  runs: number; ok: number; errors: number; cost_usd: number; avg_ms: number;
  avg_cost_per_run: number; avg_tokens_in: number; avg_tokens_out: number;
};
/** Top-level fields are REAL guests; `test` is our own traffic, kept beside it. */
type FlowStats = FlowDef & Bucket & { real: Bucket; test: Bucket };

type CostBucket = {
  turns: number; errors: number; cost_usd: number; avg_cost_per_turn: number;
  conversations: number; avg_turns_per_conversation: number; avg_cost_per_conversation: number;
  conversations_per_day: number; avg_tokens_in: number; avg_tokens_out: number; avg_ms: number;
  expected_monthly_cost: number;
};
type CostSummary = {
  available: boolean; reason?: string; window_days: number;
  restaurants: { restaurant: string; name: string; capped: boolean; real: CostBucket; test: CostBucket }[];
  totals: { real: CostBucket; test: CostBucket };
};

/** Which traffic the executions list is showing. Real guests are the default. */
type Traffic = "real" | "test" | "all";

type NearMiss = { kind: string; message: string; at: string };
type Metrics = {
  messages_in: number; bursts: number; merge_ratio: number; avg_window_ms: number;
  spam_blocks: number; faq_hits: number; closer_hits: number; llm_replies: number;
  zero_llm_rate: number; dead_letters: number;
  // all of these were already on the wire and thrown away by the console
  started_at?: string;
  fastpath_near_misses?: NearMiss[];
  sessions_total?: number; handoffs_open?: number; staff_takeovers?: number;
  replies_rated_up?: number; replies_rated_down?: number;
};

type Restaurant = { slug: string; name: string; schema: string; plan: string | null };

type Mode = "runs" | "sessions" | "tail";
const LIMIT: Record<Mode, number> = { runs: 60, sessions: 150, tail: 100 };
const POLL: Record<Mode, number> = { runs: 8000, sessions: 10000, tail: 3000 };

export default function FlowsView({ params, setParams }: { params: UrlState; setParams: (p: UrlState, push?: boolean) => void }) {
  const mode = (params.group as Mode) || "runs";
  const flow = params.flow || "";              // "" = all flows
  const restaurant = params.rest || "";
  const status = params.status || "";
  const q = params.q || "";
  const openId = params.exec || "";

  const [flows, setFlows] = useState<FlowStats[]>([]);
  const [execs, setExecs] = useState<Execution[]>([]);
  const [execution, setExecution] = useState<Execution | null>(null);
  const [offline, setOffline] = useState(false);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [showMetrics, setShowMetrics] = useState(params.m !== "0");
  const [showSuite, setShowSuite] = useState(false);
  const [showMisses, setShowMisses] = useState(false);
  const [roster, setRoster] = useState<Restaurant[]>([]);
  const [costs, setCosts] = useState<CostSummary | null>(null);
  const [showCosts, setShowCosts] = useState(false);
  const traffic = (params.traffic as Traffic) || "real";   // real guests unless asked otherwise
  const [live, setLive] = useState(true);
  const [openSessions, setOpenSessions] = useState<Record<string, boolean>>({});
  const [cursor, setCursor] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const firstSeen = useFirstSeen();
  const visible = usePageVisible();
  const polling = live && visible;      // a background tab polls nothing

  // the box types instantly; the URL and the filter follow a beat later
  const [qDraft, setQDraft] = useState(q);
  const qDebounced = useDebounced(qDraft, 250);
  useEffect(() => { if (qDebounced !== q) setParams({ q: qDebounced }); }, [qDebounced]);
  // keep the box in step when the URL changes from elsewhere (a cross-tab jump, back button)
  useEffect(() => { setQDraft((d) => (d === q ? d : q)); }, [q]);

  // The dropdown lists EVERY restaurant, not just the ones present in the rows on screen —
  // otherwise a quiet restaurant can never be selected to go and find its runs.
  useEffect(() => {
    ops.get("/api/ops/restaurants").then((r) => setRoster(r.data?.restaurants || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!showCosts || costs) return;
    ops.get("/api/ops/cost-summary?days=7").then((r) => setCosts(r.data)).catch(() => {});
  }, [showCosts, costs]);

  // ---- data ----
  useEffect(() => {
    const load = () => ops.get("/api/flows")
      .then((r) => { setFlows(r.data); setOffline(false); })
      .catch(() => setOffline(true));
    const loadMetrics = () => ops.get("/api/metrics").then((r) => setMetrics(r.data)).catch(() => {});
    load(); loadMetrics();
    const t = setInterval(() => { if (polling) { load(); loadMetrics(); } }, 15000);
    return () => clearInterval(t);
  }, [polling]);

  // Full read on mount/filter-change, then incremental: `since` asks only for runs newer
  // than the newest one already held, so a quiet 3s tail poll transfers an empty array
  // instead of 100 rows.
  const newestRef = useRef<string | null>(null);
  const execsRef = useRef<Execution[]>([]);
  useEffect(() => {
    newestRef.current = null; // filters changed → the held set is no longer a valid baseline
    let alive = true;

    const load = (incremental: boolean) => {
      // `since` only returns runs NEWER than what we hold, so a row first seen mid-flight
      // kept its spinner, its "…" duration and its empty children forever. Any unfinished
      // row on screen forces a full refetch so it can reach its terminal state.
      const hasUnfinished = execsRef.current.some((e) => e.status !== "ok" && e.status !== "error");
      const since = incremental && !hasUnfinished ? newestRef.current : null;
      return ops.get("/api/executions", {
        params: {
          ...(mode !== "runs" || !flow ? {} : { flow }),
          limit: LIMIT[mode],
          ...(since ? { since } : {}),
          // filtered in Postgres, so the limit applies to MATCHES. Filtering client-side
          // meant selecting a restaurant absent from the loaded page showed nothing while
          // thousands of its runs sat unqueried.
          ...(restaurant ? { restaurant } : {}),
          ...(status ? { status } : {}),
          ...(q.trim() ? { q: q.trim() } : {}),
        },
      }).then((r) => {
        if (!alive) return;
        const fresh = r.data as Execution[];
        firstSeen.note(fresh.map((e) => e.id));
        setExecs((prev) => {
          const merged = since
            ? [...fresh, ...prev.filter((p) => !fresh.some((f) => f.id === p.id))]
            : fresh;
          const sorted = merged.sort((a, b) => (a.started_at < b.started_at ? 1 : -1)).slice(0, LIMIT[mode]);
          newestRef.current = sorted[0]?.started_at || newestRef.current;
          execsRef.current = sorted;
          return sorted;
        });
      }).catch(() => {});
    };

    load(false);
    const t = setInterval(() => { if (polling) load(true); }, POLL[mode]);
    return () => { alive = false; clearInterval(t); };
  }, [mode, flow, polling, restaurant, status, q]);

  // the open trace is driven entirely by the URL — refresh, back button and
  // deep links all land on the same run
  useEffect(() => {
    if (!openId) return setExecution(null);
    if (execution?.id === openId) return;
    let alive = true;
    ops.get(`/api/executions/${openId}`)
      .then((r) => alive && setExecution(r.data))
      .catch(() => alive && setExecution(null));
    return () => { alive = false; };
  }, [openId]);

  // ---- filtering ----
  // restaurant / status / q are applied by the server (see the fetch above); only the
  // tail-mode flow narrowing is local, because session mode needs whole chains intact
  const rows = useMemo(
    () => execs
      .filter((e) => !(flow && mode === "tail" && e.flow !== flow))
      // our own traffic swamps the list — five suite passes a day is ~3,500 runs against
      // a handful of real turns — so real guests are what you see unless you ask
      .filter((e) => traffic === "all" || (traffic === "test" ? e.is_test : !e.is_test)),
    [execs, flow, mode, traffic]
  );

  // sessions: one row per conversation, its runs nested by parent_id so the
  // ingest → respond → master → order chain reads as a tree
  const sessions = useMemo(() => {
    if (mode !== "sessions") return [];
    const by = new Map<string, Execution[]>();
    for (const e of rows) {
      const k = e.session_id || "(no session)";
      (by.get(k) || by.set(k, []).get(k)!).push(e);
    }
    return [...by.entries()].filter(([, list]) => !flow || list.some((e) => e.flow === flow)).map(([session_id, list]) => {
      const sorted = [...list].sort((a, b) => (a.started_at < b.started_at ? -1 : 1));
      const ids = new Set(sorted.map((e) => e.id));
      const roots = sorted.filter((e) => !e.parent_id || !ids.has(e.parent_id));
      const kids = (id: string) => sorted.filter((e) => e.parent_id === id);
      const tree: { exec: Execution; depth: number }[] = [];
      const walk = (e: Execution, depth: number) => {
        tree.push({ exec: e, depth });
        for (const k of kids(e.id)) walk(k, depth + 1);
      };
      roots.forEach((r) => walk(r, 0));
      return {
        session_id,
        restaurant: sorted[0]?.restaurant || null,
        runs: sorted.length,
        errors: sorted.filter((e) => e.status === "error").length,
        cost: sorted.reduce((s, e) => s + (e.cost_usd || 0), 0),
        span: sorted.reduce((s, e) => s + (e.duration_ms || 0), 0),
        last_at: sorted[sorted.length - 1]?.started_at,
        tree,
      };
    }).sort((a, b) => (String(a.last_at) < String(b.last_at) ? 1 : -1));
  }, [rows, mode, flow]);

  // flat order the keyboard walks, whatever the grouping is
  const walkable = useMemo(
    () => (mode === "sessions" ? sessions.flatMap((s) => (openSessions[s.session_id] ? s.tree.map((t) => t.exec) : [])) : rows),
    [mode, sessions, openSessions, rows]
  );

  useEffect(() => { setCursor(0); }, [mode, flow, restaurant, status, q]);

  // ---- keyboard ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(el?.tagName || "");
      if (e.key === "Escape") { (el as HTMLInputElement)?.blur?.(); if (openId) setParams({ exec: "" }); return; }
      if (typing) return;
      if (e.key === "/") { e.preventDefault(); searchRef.current?.focus(); return; }
      if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        setCursor((c) => Math.max(0, Math.min(walkable.length - 1, c + (e.key === "j" ? 1 : -1))));
        return;
      }
      if (e.key === "Enter") {
        const target = walkable[cursor];
        if (target) setParams({ exec: target.id }, true);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [walkable, cursor, openId, setParams]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>("[data-cursor='1']")?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const open = (id: string) => setParams({ exec: id }, true);
  const canvasDef = flows.find((f) => f.name === (execution?.flow || flow)) || null;
  const isNew = (e: Execution) => mode === "tail" && firstSeen.isNew(e.id);

  // ingest → the respond run this burst became
  async function jumpToRespond(sessionId: string, after: string) {
    const { data } = await ops.get("/api/executions", { params: { flow: "respond", limit: 50 } });
    const match = (data as Execution[])
      .filter((e) => e.session_id === sessionId && e.started_at >= after)
      .sort((a, b) => (a.started_at < b.started_at ? -1 : 1))[0]
      || (data as Execution[]).find((e) => e.session_id === sessionId);
    if (match) open(match.id);
  }

  const clearFilters = () => setParams({ rest: "", status: "", q: "" });
  const filtered = !!(restaurant || status || q);

  return (
    <div className="flex h-full flex-col">
      {/* ---------- toolbar ---------- */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-zinc-800 px-4 py-2.5">
        <Segments<Traffic>
          value={traffic}
          onChange={(v) => setParams({ traffic: v === "real" ? "" : v })}
          options={[["real", "Real"], ["test", "Test"], ["all", "All"]]}
        />
        <Segments<Mode>
          value={mode}
          onChange={(v) => setParams({ group: v === "runs" ? "" : v })}
          options={[["runs", "Runs"], ["sessions", "Sessions"], ["tail", "Live tail"]]}
        />
        <div className="relative">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            ref={searchRef}
            value={qDraft}
            onChange={(e) => setQDraft(e.target.value)}
            placeholder="session, id, error…  ( / )"
            className="w-64 rounded-xl border border-zinc-700 bg-zinc-900 py-1.5 pr-7 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-amber-500"
            style={{ paddingLeft: 28 }}
          />
          {qDraft && (
            <button onClick={() => { setQDraft(""); setParams({ q: "" }); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200">
              <X size={13} />
            </button>
          )}
        </div>
        <Select
          value={restaurant}
          onChange={(v) => setParams({ rest: v })}
          options={[["", "all restaurants"], ...roster.map((r) => [r.slug, r.name || r.slug] as [string, string])]}
        />
        <Select
          value={status}
          onChange={(v) => setParams({ status: v })}
          options={[["", "any status"], ["ok", "ok only"], ["error", "errors only"]]}
        />
        {filtered && (
          <button onClick={clearFilters} className="text-xs text-zinc-500 underline-offset-2 hover:text-amber-400 hover:underline">
            clear
          </button>
        )}
        <span className="text-xs text-zinc-500">{rows.length} of {execs.length}</span>

        <div className="ml-auto flex items-center gap-2">
          <LiveDot live={polling} label={!visible ? "tab hidden" : live ? "live" : "paused"} />
          <button onClick={() => setLive((v) => !v)} title={live ? "Pause polling" : "Resume polling"}
            className="rounded-lg border border-zinc-700 p-1.5 text-zinc-300 transition hover:bg-zinc-800">
            {live ? <Pause size={13} /> : <Play size={13} />}
          </button>
          <button onClick={() => { setParams({ m: showMetrics ? "0" : "" }); setShowMetrics(!showMetrics); }}
            title="Platform metrics"
            className={`rounded-lg border p-1.5 transition ${showMetrics ? "border-amber-500/60 text-amber-400" : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"}`}>
            <BarChart3 size={13} />
          </button>
          <button onClick={() => setShowCosts((v) => !v)} title="Real-guest cost per turn and per conversation"
            className={`rounded-lg border p-1.5 transition ${showCosts ? "border-amber-500/60 text-amber-400" : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"}`}>
            <DollarSign size={13} />
          </button>
          <button onClick={() => setShowMisses((v) => !v)} title="Fast-path near misses — phrasings that almost answered for free"
            className={`relative rounded-lg border p-1.5 transition ${showMisses ? "border-amber-500/60 text-amber-400" : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"}`}>
            <Zap size={13} />
            {!!metrics?.fastpath_near_misses?.length && (
              <span className="absolute -right-1 -top-1 rounded-full bg-amber-500 px-1 text-[9px] font-bold text-zinc-950">
                {metrics.fastpath_near_misses.length}
              </span>
            )}
          </button>
          <button onClick={() => setShowSuite((v) => !v)} title="Regression suite"
            className={`rounded-lg border p-1.5 transition ${showSuite ? "border-amber-500/60 text-amber-400" : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"}`}>
            <FlaskConical size={13} />
          </button>
        </div>
      </div>

      {showCosts && <CostStrip c={costs} />}
      {showMetrics && metrics && <MetricsStrip m={metrics} />}
      {showMisses && <NearMissPanel misses={metrics?.fastpath_near_misses || []} />}
      {showSuite && <RegressionPanel />}

      {/* ---------- 3 panes ---------- */}
      <div className="flex min-h-0 flex-1">
        {/* rail */}
        <div className="w-52 shrink-0 overflow-y-auto border-r border-zinc-800 p-2">
          {offline && <div className="mb-2 rounded-xl border border-red-500/40 bg-red-500/10 p-2 text-[11px] text-red-300">flows service offline</div>}
          {/* No summed cost here on purpose: a flow's cost_usd includes the sub-flows it
              spawned, so adding the flows together counts the same money several times
              (see migration 035). The Cost tab is the place for a real total. */}
          <RailItem
            active={!flow}
            onClick={() => setParams({ flow: "" })}
            title="All flows"
            sub={`${flows.reduce((s, f) => s + f.real.runs, 0).toLocaleString()} real runs · see Cost tab for spend`}
            errors={flows.reduce((s, f) => s + f.real.errors, 0)}
          />
          {flows.map((fl) => (
            <RailItem
              key={fl.name}
              active={flow === fl.name}
              onClick={() => setParams({ flow: fl.name })}
              title={fl.name}
              sub={`${fl.real.runs} runs · ${fl.real.errors} err · ${usd(fl.real.cost_usd, 4)}${fl.real.runs ? ` · avg ${usd(fl.real.avg_cost_per_run, 4)}/turn` : ""}`}
              testSub={fl.test.runs ? `+ ${fl.test.runs.toLocaleString()} test runs · ${usd(fl.test.cost_usd, 4)}` : null}
              errors={fl.real.errors}
            />
          ))}
        </div>

        {/* list */}
        <div ref={listRef} className="w-[27rem] shrink-0 overflow-y-auto border-r border-zinc-800">
          {(mode === "sessions" ? sessions.length === 0 : rows.length === 0) ? (
            // gated on the collection actually rendered — checking `rows` here left the
            // pane completely blank when a flow filter excluded every session
            <Empty text={filtered || flow ? "Nothing matches those filters" : "No executions yet"} />
          ) : mode === "sessions" ? (
            sessions.map((s) => {
              const isOpen = !!openSessions[s.session_id];
              return (
                <div key={s.session_id} className="border-b border-zinc-800/70">
                  <button
                    onClick={() => setOpenSessions((o) => ({ ...o, [s.session_id]: !isOpen }))}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition hover:bg-zinc-900"
                  >
                    {isOpen ? <ChevronDown size={14} className="shrink-0 text-zinc-500" /> : <ChevronRight size={14} className="shrink-0 text-zinc-500" />}
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-xs text-zinc-200">{s.session_id}</div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-zinc-500">
                        {s.restaurant && <Badge tone="sky">{s.restaurant}</Badge>}
                        <span>{s.runs} runs</span>
                        {s.errors > 0 && <span className="text-red-400">{s.errors} err</span>}
                        <span>· {ago(s.last_at)}</span>
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-[10px] tabular-nums text-zinc-400">
                      <div>{ms(s.span)}</div>
                      <div>{usd(s.cost, 4)}</div>
                    </div>
                  </button>
                  {isOpen && (
                    <div className="bg-zinc-950/40 pb-1">
                      {s.tree.map(({ exec, depth }) => (
                        <ExecRow
                          key={exec.id} e={exec} depth={depth} selected={openId === exec.id}
                          cursor={walkable[cursor]?.id === exec.id} onClick={() => open(exec.id)} showFlow showTest={traffic === "all"}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            rows.map((e) => (
              <ExecRow
                key={e.id} e={e} selected={openId === e.id} cursor={walkable[cursor]?.id === e.id}
                onClick={() => open(e.id)} showFlow={mode === "tail" || !flow} fresh={isNew(e)} showTest={traffic === "all"}
              />
            ))
          )}
        </div>

        {/* detail — a fixed-height column so the trace panes scroll independently */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden p-5">
          {!execution ? (
            <div className="flex h-full flex-col items-center justify-center text-center text-sm text-zinc-500">
              <Workflow size={28} className="mb-3 text-zinc-700" />
              Pick a run to see its trace.
              <div className="mt-2 text-xs text-zinc-600">
                <kbd className="rounded bg-zinc-800 px-1">j</kbd>/<kbd className="rounded bg-zinc-800 px-1">k</kbd> to walk ·{" "}
                <kbd className="rounded bg-zinc-800 px-1">↵</kbd> to open · <kbd className="rounded bg-zinc-800 px-1">/</kbd> to search ·{" "}
                <kbd className="rounded bg-zinc-800 px-1">esc</kbd> to close
              </div>
            </div>
          ) : (
            <>
              <DetailHeader e={execution} onClose={() => setParams({ exec: "" })}
                onSession={() => setParams({ group: "sessions", q: execution.session_id })} />
              {canvasDef ? (
                <TraceView def={canvasDef} execution={execution} onOpenChild={open} onJumpToRespond={jumpToRespond} />
              ) : (
                <Card><Empty text={`No flow definition registered for "${execution.flow}"`} /></Card>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function RailItem({ active, onClick, title, sub, testSub, errors }: {
  active: boolean; onClick: () => void; title: string; sub: string; testSub?: string | null; errors: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`mb-1 w-full rounded-xl border px-2.5 py-2 text-left transition ${
        active ? "border-amber-500/60 bg-amber-500/5" : "border-transparent hover:border-zinc-700 hover:bg-zinc-900"
      }`}
    >
      <div className="flex items-center gap-1.5 text-sm font-semibold">
        <Workflow size={13} className={active ? "text-amber-400" : "text-zinc-500"} />
        <span className="truncate">{title}</span>
        {errors > 0 && <span className="ml-auto rounded bg-red-500/15 px-1 text-[10px] font-semibold text-red-300">{errors}</span>}
      </div>
      <div className="mt-0.5 truncate text-[10px] tabular-nums text-zinc-500">{sub}</div>
      {/* our own traffic, deliberately quieter than the guests' */}
      {testSub && <div className="truncate text-[10px] tabular-nums text-zinc-600">{testSub}</div>}
    </button>
  );
}

function ExecRow({ e, selected, cursor, onClick, showFlow, depth = 0, fresh, showTest }: {
  e: Execution; selected: boolean; cursor: boolean; onClick: () => void;
  showFlow?: boolean; depth?: number; fresh?: boolean; showTest?: boolean;
}) {
  return (
    <button
      data-cursor={cursor ? "1" : "0"}
      onClick={onClick}
      style={{ paddingLeft: 12 + depth * 14 }}
      className={`flex w-full items-center gap-2.5 border-l-2 py-2 pr-3 text-left transition ${
        selected ? "border-l-amber-500 bg-amber-500/5" : cursor ? "border-l-zinc-500 bg-zinc-900" : "border-l-transparent hover:bg-zinc-900"
      } ${fresh ? "animate-[pulse_1.2s_ease-in-out_2]" : ""}`}
    >
      <StatusIcon status={e.status} small />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5 text-xs">
          {showFlow && <span className="shrink-0 font-semibold text-amber-400">{e.flow}</span>}
          <span className="shrink-0 text-zinc-300" title={full(e.started_at)}>{clock(e.started_at)}</span>
          <span className="shrink-0 text-[10px] text-zinc-500">{ago(e.started_at)}</span>
          <span className="ml-auto shrink-0 tabular-nums text-zinc-300">{ms(e.duration_ms)}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-zinc-500">
          {showTest && e.is_test && <Badge title="our own traffic: suite, harness, ops Test Chat or a fixture phone">test</Badge>}
          {e.restaurant && <Badge tone="sky">{e.restaurant}</Badge>}
          <span className="truncate font-mono">{e.session_id}</span>
          <span className="shrink-0 truncate">{e.trigger}</span>
          <span className="ml-auto shrink-0 tabular-nums">
            {(e.tokens_in || e.tokens_out) ? `${tokens(e.tokens_in)}→${tokens(e.tokens_out)} · ` : ""}
            <span className={e.cost_usd > 0 ? "text-zinc-300" : ""}>{usd(e.cost_usd, 4)}</span>
          </span>
        </div>
        {/* what this run went on to do — the closest thing to "what happened" the list has */}
        {e.children?.length > 0 && (
          <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-zinc-500">
            <CornerDownRight size={9} className="shrink-0" />
            {e.children.map((c, i) => (
              <span key={`${c.execution_id}-${i}`} className="rounded bg-zinc-800 px-1 text-amber-300/80">{c.flow}</span>
            ))}
          </div>
        )}
        {e.error && <div className="mt-0.5 truncate text-[10px] text-red-400" title={e.error}>{e.error}</div>}
      </div>
    </button>
  );
}

function DetailHeader({ e, onClose, onSession }: { e: Execution; onClose: () => void; onSession: () => void }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  async function copy() {
    // clipboard access rejects on a non-secure origin or a denied permission; unhandled it
    // was a silent no-op plus an unhandled rejection in the console
    try {
      await navigator.clipboard.writeText(traceToMarkdown(e));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setFailed(true);
      setTimeout(() => setFailed(false), 2500);
    }
  }
  return (
    <div className="mb-4 shrink-0">
      <div className="flex flex-wrap items-center gap-2">
        <StatusIcon status={e.status} />
        <span className="text-lg font-semibold">{e.flow}</span>
        {e.restaurant && <Badge tone="sky">{e.restaurant}</Badge>}
        <Badge>{e.trigger}</Badge>
        <span className="text-xs text-zinc-500" title={full(e.started_at)}>{clock(e.started_at)} · {ago(e.started_at)}</span>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={onSession} title="Show the whole conversation"
            className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-2 py-1 text-xs text-zinc-300 transition hover:bg-zinc-800">
            <Layers size={12} /> Session
          </button>
          <button onClick={copy} title="Copy the whole trace as markdown"
            className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-2 py-1 text-xs text-zinc-300 transition hover:bg-zinc-800">
            {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />} {copied ? "Copied" : failed ? "Copy blocked" : "Copy trace"}
          </button>
          <button onClick={onClose} className="rounded-lg border border-zinc-700 p-1 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100">
            <X size={13} />
          </button>
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-zinc-500">
        <span className="font-mono">{e.session_id}</span>
        <span>{ms(e.duration_ms)}</span>
        <span>{tokens(e.tokens_in)}→{tokens(e.tokens_out)} tok</span>
        <span>{usd(e.cost_usd)}</span>
        <span className="font-mono text-zinc-600">{e.id}</span>
      </div>
      {e.error && <div className="mt-2 rounded-xl border border-red-500/40 bg-red-500/10 p-2.5 text-xs text-red-300">{e.error}</div>}
    </div>
  );
}

/**
 * What real guests cost. A `respond` row is one guest turn and its cost already includes
 * the sub-flows it spawned, so a turn is that one row — never the row plus its children.
 * Our own traffic sits underneath, muted, because it dwarfs the real numbers: on
 * 2026-08-17 the friendly card read $6.35 cumulative while guests had cost $0.01.
 */
function CostStrip({ c }: { c: CostSummary | null }) {
  if (!c) return <div className="shrink-0 border-b border-zinc-800 bg-zinc-900/30 px-4 py-2 text-[11px] text-zinc-500">Loading cost summary…</div>;
  if (!c.available) {
    return (
      <div className="shrink-0 border-b border-zinc-800 bg-zinc-900/30 px-4 py-2 text-[11px] text-zinc-500">
        Cost summary unavailable: {c.reason}
      </div>
    );
  }
  const formula = "avg cost per conversation × conversations per day × 30";
  const Cell = ({ label, value, sub, hint }: { label: string; value: string; sub?: string; hint?: string }) => (
    <div title={hint} className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="truncate text-sm font-semibold tabular-nums text-zinc-100">{value}</div>
      {sub && <div className="truncate text-[10px] tabular-nums text-zinc-600">{sub}</div>}
    </div>
  );

  return (
    <div className="shrink-0 border-b border-zinc-800 bg-zinc-900/30 px-4 py-2.5">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <DollarSign size={13} className="text-amber-400" />
        <span className="text-sm font-semibold">Real-guest cost</span>
        <span className="text-[11px] text-zinc-500">
          last {c.window_days} days · a turn is one <code className="text-zinc-400">respond</code> run · test traffic excluded
        </span>
        <span className="ml-auto text-[11px] tabular-nums text-zinc-400">
          all restaurants: {usd(c.totals.real.cost_usd, 4)} real
          <span className="text-zinc-600"> · {usd(c.totals.test.cost_usd, 2)} ours</span>
        </span>
      </div>
      <div className="space-y-2">
        {c.restaurants.map((r) => (
          <div key={r.restaurant} className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-xs font-semibold text-zinc-200">{r.name}</span>
              <span className="font-mono text-[10px] text-zinc-600">{r.restaurant}</span>
              {r.real.turns === 0 && <Badge tone="zinc">no real turns yet</Badge>}
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
              <Cell label="real turns" value={r.real.turns.toLocaleString()} sub={`${r.real.conversations} conversations`} />
              <Cell label="real cost" value={usd(r.real.cost_usd, 4)} hint="sum of respond-run cost for non-test sessions" />
              <Cell label="per turn" value={usd(r.real.avg_cost_per_turn, 4)} sub={`${r.real.avg_tokens_in}→${r.real.avg_tokens_out} tok`} />
              <Cell label="per conversation" value={usd(r.real.avg_cost_per_conversation, 4)} sub={`${r.real.avg_turns_per_conversation} turns each`} />
              <Cell label="conversations/day" value={String(r.real.conversations_per_day)} sub={`over ${c.window_days} days`} />
              <Cell label="expected monthly" value={usd(r.real.expected_monthly_cost, 2)} hint={formula} sub="at today's rate" />
            </div>
            <div className="mt-1.5 border-t border-zinc-800/60 pt-1.5 text-[10px] tabular-nums text-zinc-600">
              our own traffic: {r.test.turns.toLocaleString()} turns · {usd(r.test.cost_usd, 4)} · {usd(r.test.avg_cost_per_turn, 4)}/turn · {r.test.conversations} sessions
              {r.capped && <span className="ml-2 text-amber-500/70">read cap hit — a floor</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MetricsStrip({ m }: { m: Metrics }) {
  const traffic: Cell[] = [
    ["msgs in", String(m.messages_in)],
    ["bursts", String(m.bursts)],
    ["merge ratio", `${m.merge_ratio}×`, "msgs per reply — buffering saving LLM calls"],
    ["0-LLM rate", `${m.zero_llm_rate}%`, "answered free by fast paths"],
    ["llm replies", String(m.llm_replies)],
    ["faq hits", String(m.faq_hits)],
    ["closers", String(m.closer_hits)],
    ["spam", String(m.spam_blocks)],
    ["dead letters", String(m.dead_letters), "messages that never got a reply", m.dead_letters > 0],
  ];
  // conversation outcomes. NOTE: flows computes these with resolveRestaurant() — the
  // DEFAULT tenant only — unlike every other ops endpoint, so they are labelled
  // "pilot only" rather than presented as platform-wide numbers.
  const PILOT = "counts the default tenant only — flows computes these with resolveRestaurant(), not across all restaurants";
  const outcomes: Cell[] = [
    ["sessions", String(m.sessions_total ?? "—"), PILOT],
    ["handoffs open", String(m.handoffs_open ?? "—"), `guests waiting for a human · ${PILOT}`, (m.handoffs_open ?? 0) > 0],
    ["takeovers", String(m.staff_takeovers ?? "—"), `AI switched off by staff · ${PILOT}`],
    ["👍", String(m.replies_rated_up ?? "—"), PILOT],
    ["👎", String(m.replies_rated_down ?? "—"), PILOT, (m.replies_rated_down ?? 0) > 0],
  ];

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-zinc-800 bg-zinc-900/30 px-4 py-2">
      {traffic.map((c) => <Cell key={c[0]} c={c} />)}
      <span className="h-4 w-px bg-zinc-800" />
      <span className="text-[10px] uppercase tracking-wide text-zinc-600" title={PILOT}>pilot</span>
      {outcomes.map((c) => <Cell key={c[0]} c={c} />)}
      {m.started_at && (
        <span className="ml-auto text-[10px] text-zinc-500" title={`flows process started ${full(m.started_at)} — roughly when it was last deployed`}>
          flows up {ago(m.started_at).replace(" ago", "")}
        </span>
      )}
    </div>
  );
}

type Cell = [string, string, string?, boolean?];
function Cell({ c: [label, value, hint, bad] }: { c: Cell }) {
  return (
    <div title={hint} className="flex items-baseline gap-1.5">
      <span className={`text-sm font-semibold tabular-nums ${bad ? "text-red-400" : "text-zinc-200"}`}>{value}</span>
      <span className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</span>
    </div>
  );
}

/**
 * Messages where a fast path ALMOST fired. Each one is a phrasing that fell through
 * to a paid LLM call and didn't have to — this is the backlog for "code computes,
 * the LLM phrases". flows keeps the last 50 in a ring buffer.
 */
function NearMissPanel({ misses }: { misses: NearMiss[] }) {
  const groups = useMemo(() => {
    const by = new Map<string, NearMiss[]>();
    for (const n of misses) (by.get(n.kind) || by.set(n.kind, []).get(n.kind)!).push(n);
    return [...by.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [misses]);

  return (
    <div className="max-h-56 shrink-0 overflow-y-auto border-b border-zinc-800 bg-zinc-900/30 px-4 py-2.5">
      <div className="mb-2 flex items-center gap-2">
        <Zap size={13} className="text-amber-400" />
        <span className="text-sm font-semibold">Fast-path near misses</span>
        <span className="text-[11px] text-zinc-500">
          {misses.length === 0
            ? "nothing recent — every message either hit a fast path or genuinely needed the LLM"
            : `${misses.length} message${misses.length === 1 ? "" : "s"} that almost answered for free (last 50 kept)`}
        </span>
      </div>
      {groups.length > 0 && (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {groups.map(([kind, list]) => (
            <div key={kind} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-2">
              <div className="mb-1 flex items-center gap-1.5">
                <span className="font-mono text-[11px] font-semibold text-amber-300">{kind}</span>
                <span className="rounded bg-zinc-800 px-1 text-[10px] font-semibold">×{list.length}</span>
              </div>
              <div className="space-y-0.5">
                {list.slice(-6).reverse().map((n, i) => (
                  <div key={i} className="flex items-baseline gap-1.5 text-[11px]">
                    <span className="min-w-0 flex-1 truncate text-zinc-300" title={n.message}>{n.message}</span>
                    <span className="shrink-0 text-[9px] text-zinc-600">{ago(n.at)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
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

  // `only` re-runs a subset by case id — the server has always supported it; the
  // console could only ever run all 113, so re-checking one fix cost the whole suite
  async function run(only?: string[]) {
    await ops.post("/api/ops/run-regression", only?.length ? { only } : {});
    setOpen(true);
    setState((s: any) => ({ ...(s || {}), status: "running", results: [], total: only?.length || s?.suite_size }));
  }

  const running = state?.status === "running";
  const done = state?.status === "done";
  // the server reports the real suite size; the panel used to hardcode 20 and a
  // full run looked hung a fifth of the way in
  const total = state?.total || state?.suite_size || 0;
  const ran = state?.results?.length || 0;
  const failed = (state?.results || []).filter((r: any) => !r.pass);

  return (
    <div className="shrink-0 border-b border-zinc-800 bg-zinc-900/30 px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-1.5 text-sm font-semibold"><FlaskConical size={14} className="text-amber-400" /> Regression suite</span>
        {running && (
          <span className="flex items-center gap-2 text-xs text-amber-400">
            <span className="animate-pulse">running… {ran}/{total || "?"}</span>
            {total > 0 && <span className="h-1 w-32 overflow-hidden rounded-full bg-zinc-800">
              <span className="block h-full rounded-full bg-amber-500" style={{ width: `${Math.round((ran / total) * 100)}%` }} />
            </span>}
          </span>
        )}
        {done && (
          <button onClick={() => setOpen((v) => !v)} className={`text-xs font-semibold ${state.failed ? "text-red-400" : "text-emerald-400"}`}>
            {state.passed}/{state.passed + state.failed} passed {state.failed ? "❌" : "✅"} — {open ? "hide" : "details"}
          </button>
        )}
        {/* a suite that fails to START reports status "error" — without this the panel
            fell back to the idle line and the failure was invisible */}
        {state?.status === "error" && (
          <span className="flex items-center gap-1.5 text-xs text-red-400">
            <XCircle size={12} /> suite failed to run: {state.error || "unknown error"}
          </span>
        )}
        {!running && !done && state?.status !== "error" && (
          <span className="text-xs text-zinc-500">{total || "—"} cases through the real pipeline (ahlan-pilot tenant)</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {done && failed.length > 0 && !running && (
            <button onClick={() => run(failed.map((r: any) => r.id))}
              className="flex items-center gap-1.5 rounded-xl border border-red-500/50 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-300 transition hover:bg-red-500/20">
              <RotateCcw size={12} /> Re-run {failed.length} failed
            </button>
          )}
          <button onClick={() => run()} disabled={running}
            className="rounded-xl bg-amber-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:opacity-40">
            Run all
          </button>
        </div>
      </div>
      {open && done && (
        <div className="mt-3 grid max-h-64 gap-1.5 overflow-y-auto md:grid-cols-2">
          {state.results.map((r: any) => (
            <div key={r.id} className={`group rounded-lg border px-3 py-2 text-xs ${r.pass ? "border-zinc-800 bg-zinc-900" : "border-red-500/50 bg-red-500/10"}`}>
              <div className="flex items-start gap-1.5">
                <span className="min-w-0 flex-1 font-medium">{r.pass ? "✅" : "❌"} {r.name}</span>
                <button onClick={() => run([r.id])} disabled={running} title={`Re-run just "${r.id}"`}
                  className="shrink-0 text-zinc-600 opacity-0 transition hover:text-amber-400 group-hover:opacity-100 disabled:opacity-0">
                  <RotateCcw size={11} />
                </button>
              </div>
              {!r.pass && <div className="mt-0.5 text-red-300">{r.failures?.join("; ")}</div>}
              {!r.pass && r.reply && <div className="mt-0.5 text-zinc-400">reply: {r.reply.slice(0, 120)}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function StatusIcon({ status, small }: { status: string; small?: boolean }) {
  const size = small ? 13 : 16;
  if (status === "ok") return <CheckCircle2 size={size} className="shrink-0 text-emerald-400" />;
  if (status === "error") return <XCircle size={size} className="shrink-0 text-red-400" />;
  return <CircleDashed size={size} className="shrink-0 animate-spin text-amber-400" />;
}
