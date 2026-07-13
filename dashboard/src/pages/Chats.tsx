import { useEffect, useRef, useState } from "react";
import { Send, Bot, BotOff, Instagram, MessageCircle } from "lucide-react";
import { api } from "../config/api";
import { Card, PageHeader, Btn, Input, Empty } from "../components/ui";

export default function Chats() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [active, setActive] = useState<any | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [text, setText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadSessions = () =>
    api.get("/api/chat/sessions").then((r) => {
      const rows = [...r.data].sort((a: any, b: any) =>
        // needs-attention first, then most recent
        (b.needs_attention ? 1 : 0) - (a.needs_attention ? 1 : 0) ||
        String(b.last_message_at || "").localeCompare(String(a.last_message_at || ""))
      );
      setSessions(rows);
    }).catch(() => {});
  useEffect(() => {
    loadSessions();
    const t = setInterval(loadSessions, 10000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!active) return;
    const load = () =>
      api.get(`/api/chat/sessions/${encodeURIComponent(active.session_id)}/messages`).then((r) => setMessages(r.data)).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [active?.session_id]);

  useEffect(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), [messages.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || !active) return;
    await api.post(`/api/chat/sessions/${encodeURIComponent(active.session_id)}/messages`, { message: text });
    setText("");
    const { data } = await api.get(`/api/chat/sessions/${encodeURIComponent(active.session_id)}/messages`);
    setMessages(data);
    loadSessions();
  }

  async function toggleAi() {
    if (!active) return;
    const next = !active.ai_enabled;
    await api.patch(`/api/chat/sessions/${active.id}`, { ai_enabled: next });
    setActive({ ...active, ai_enabled: next });
    loadSessions();
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Chats" subtitle="WhatsApp & Instagram conversations — take over from the AI any time" />
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-3">
        <Card className="overflow-y-auto lg:col-span-1">
          {sessions.length === 0 ? (
            <Empty text="No conversations" />
          ) : (
            sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => setActive(s)}
                className={`flex w-full items-start gap-3 border-b border-zinc-800/60 px-4 py-3 text-left transition hover:bg-zinc-900 ${active?.id === s.id ? "bg-zinc-900" : ""}`}
              >
                <div className="mt-0.5 text-zinc-500">
                  {s.channel === "instagram" ? <Instagram size={16} /> : <MessageCircle size={16} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{s.diner_name || s.phone_number || s.session_id}</span>
                    {s.needs_attention && <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" />}
                  </div>
                  <div className="truncate text-xs text-zinc-500">{s.last_message}</div>
                  <div className="mt-0.5 text-[10px] text-zinc-600">
                    {s.diner_name ? `${s.phone_number || s.session_id} · ` : ""}{s.session_type || "chat"} · AI {s.ai_enabled ? "on" : "off"}
                  </div>
                </div>
              </button>
            ))
          )}
        </Card>

        <Card className="flex min-h-0 flex-col lg:col-span-2">
          {!active ? (
            <Empty text="Select a conversation" />
          ) : (
            <>
              <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
                <div>
                  <div className="text-sm font-semibold">
                    {active.diner_name || active.phone_number || active.session_id}
                    {active.diner_name && <span className="ml-2 text-xs font-normal text-zinc-500">{active.phone_number || active.session_id}</span>}
                  </div>
                  {active.handoff_briefing && (
                    <div className="mt-0.5 max-w-md text-xs text-amber-300">🤝 {active.handoff_briefing}</div>
                  )}
                </div>
                <Btn variant={active.ai_enabled ? "ghost" : "primary"} className="px-3 py-1.5 text-xs" onClick={toggleAi}>
                  <span className="flex items-center gap-1.5">
                    {active.ai_enabled ? <><Bot size={14} /> AI on — take over</> : <><BotOff size={14} /> AI off — hand back</>}
                  </span>
                </Btn>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto p-4">
                {messages.map((m) => (
                  <div key={m.id} className={`flex ${m.sender === "guest" ? "justify-start" : "justify-end"}`}>
                    <div
                      className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm ${
                        m.sender === "guest"
                          ? "bg-zinc-800 text-zinc-100"
                          : m.sender === "ai"
                          ? "bg-amber-500/15 text-amber-100"
                          : "bg-sky-500/20 text-sky-100"
                      }`}
                    >
                      {m.sender !== "guest" && (
                        <div className="mb-0.5 text-[10px] uppercase tracking-wide opacity-60">{m.sender}</div>
                      )}
                      {m.media_url && m.media_type === "image" && (
                        <img src={m.media_url} alt="" className="mb-1.5 max-h-52 rounded-xl" />
                      )}
                      {m.media_url && m.media_type === "audio" && (
                        <audio controls src={m.media_url} className="mb-1.5 h-9 w-56" />
                      )}
                      {m.message}
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
              <form onSubmit={send} className="flex gap-2 border-t border-zinc-800 p-3">
                <Input className="flex-1" placeholder="Reply as staff…" value={text} onChange={(e) => setText(e.target.value)} />
                <Btn type="submit"><Send size={15} /></Btn>
              </form>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
