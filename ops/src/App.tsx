import { useEffect, useState } from "react";
import { Flame, Workflow, MessageCircle, Activity, LogOut } from "lucide-react";
import { ops, getToken, setToken, clearToken } from "./config";
import { Card, Btn, Input } from "./ui";
import FlowsView from "./FlowsView";
import ChatView from "./ChatView";
import HealthView from "./HealthView";

type Tab = "flows" | "chat" | "health";

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>("flows");
  const [tokenInput, setTokenInput] = useState("");
  const [error, setError] = useState("");

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

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500 text-zinc-950"><Flame size={16} /></div>
          <div className="text-sm font-bold">Munadim Ops</div>
          <nav className="ml-6 flex gap-1">
            <TabBtn active={tab === "flows"} onClick={() => setTab("flows")} icon={<Workflow size={14} />} label="Flows & Executions" />
            <TabBtn active={tab === "chat"} onClick={() => setTab("chat")} icon={<MessageCircle size={14} />} label="Test Chat" />
            <TabBtn active={tab === "health"} onClick={() => setTab("health")} icon={<Activity size={14} />} label="Health" />
          </nav>
        </div>
        <button onClick={() => { clearToken(); location.reload(); }} className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-red-400">
          <LogOut size={13} /> Sign out
        </button>
      </header>
      <main className="p-6">
        {tab === "flows" ? <FlowsView /> : tab === "chat" ? <ChatView /> : <HealthView />}
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
