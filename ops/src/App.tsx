import { useEffect, useState } from "react";
import { Flame, Workflow, MessageCircle, Activity, DollarSign, TrendingUp, LogOut } from "lucide-react";
import { ops, getToken, setToken, clearToken } from "./config";
import { Btn, Input } from "./ui";
import { useUrl } from "./urlstate";
import FlowsView from "./FlowsView";
import ChatView from "./ChatView";
import HealthView from "./HealthView";
import CostView from "./CostView";
import InsightsView from "./InsightsView";

const TABS = [
  { id: "flows", label: "Flows & Executions", icon: <Workflow size={14} /> },
  { id: "chat", label: "Test Chat", icon: <MessageCircle size={14} /> },
  { id: "health", label: "Health", icon: <Activity size={14} /> },
  { id: "insights", label: "Insights", icon: <TrendingUp size={14} /> },
  { id: "cost", label: "Cost", icon: <DollarSign size={14} /> },
];

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [error, setError] = useState("");
  const { tab, params, setTab, setParams } = useUrl();

  useEffect(() => {
    if (!getToken()) return setAuthed(false);
    ops.get("/api/ops/verify").then(() => setAuthed(true)).catch(() => setAuthed(false));
  }, []);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setToken(tokenInput.trim());
    try {
      await ops.get("/api/ops/verify");
      setAuthed(true);
      setError("");
    } catch {
      clearToken();
      setError("Invalid ops token");
    }
  }

  if (authed === null) return <div className="p-10 text-sm text-zinc-500">…</div>;

  if (!authed)
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center justify-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-500 text-zinc-950"><Flame size={22} /></div>
            <div>
              <div className="text-xl font-bold">Munadim Ops</div>
              <div className="text-xs text-zinc-400">Internal — agents control room</div>
            </div>
          </div>
          <form onSubmit={login} className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
            <Input type="password" placeholder="Ops token" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} className="w-full" />
            {error && <div className="text-sm text-red-400">{error}</div>}
            <Btn type="submit" className="w-full">Enter</Btn>
          </form>
        </div>
      </div>
    );

  // The shell owns the viewport: header is fixed height, the view gets the rest and
  // scrolls its own panes. Nothing below the header scrolls the page itself, so the
  // canvas stays put while you walk an execution list.
  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500 text-zinc-950"><Flame size={16} /></div>
          <div className="text-sm font-bold">Munadim Ops</div>
          <nav className="ml-6 flex gap-1">
            {TABS.map((t) => (
              <TabBtn key={t.id} active={tab === t.id} onClick={() => setTab(t.id)} icon={t.icon} label={t.label} />
            ))}
          </nav>
        </div>
        <button onClick={() => { clearToken(); location.reload(); }} className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-red-400">
          <LogOut size={13} /> Sign out
        </button>
      </header>
      <main className="min-h-0 flex-1 overflow-hidden">
        {/* `group` must be a value from FlowsView's Mode union. It read "session" once, so
            POLL[mode] was undefined and setInterval fell back to 0ms — a tight loop
            hammering /api/executions, which fans out to every tenant database. */}
        {tab === "chat" ? <ChatView onWatch={(sid) => { setTab("flows"); setParams({ q: sid, group: "sessions" }); }} />
          : tab === "health" ? <HealthView onOpenTrace={(id) => { setTab("flows"); setParams({ exec: id }); }} />
          : tab === "insights" ? <InsightsView />
          : tab === "cost" ? <CostView onOpenTrace={(id) => { setTab("flows"); setParams({ exec: id }); }} />
          : <FlowsView params={params} setParams={setParams} />}
      </main>
    </div>
  );
}

function TabBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition ${active ? "bg-amber-500/10 font-semibold text-amber-400" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"}`}
    >
      {icon} {label}
    </button>
  );
}
