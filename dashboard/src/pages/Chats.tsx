import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Send, Bot, BotOff, Instagram, MessageCircle } from "lucide-react";
import { api } from "../config/api";
import { Card, PageHeader, Btn, Input, Empty } from "../components/ui";

export default function Chats() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [active, setActive] = useState<any | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [text, setText] = useState("");
  const [ctx, setCtx] = useState<any | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadContext = (sessionId: string) =>
    api.get(`/api/chat/sessions/${encodeURIComponent(sessionId)}/context`).then((r) => setCtx(r.data)).catch(() => setCtx(null));

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

  // deep-link from a reservation card: /chats?session=<phone>
  const [params] = useSearchParams();
  useEffect(() => {
    const want = params.get("session");
    if (want && !active && sessions.length) {
      const s = sessions.find((x) => x.session_id === want || x.phone_number === want);
      if (s) setActive(s);
    }
  }, [sessions, params]);

  useEffect(() => {
    if (!active) return;
    const load = () =>
      api.get(`/api/chat/sessions/${encodeURIComponent(active.session_id)}/messages`).then((r) => setMessages(r.data)).catch(() => {});
    load();
    loadContext(active.session_id);
    const t = setInterval(load, 5000);
    const tc = setInterval(() => loadContext(active.session_id), 20000);
    return () => { clearInterval(t); clearInterval(tc); };
  }, [active?.session_id]);

  useEffect(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), [messages.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || !active) return;
    await api.post(`/api/chat/sessions/${encodeURIComponent(active.session_id)}/messages`, { message: text });
    setText("");
    // backend auto-pauses the AI on staff reply — reflect it immediately
    if (active.ai_enabled) setActive({ ...active, ai_enabled: false });
    const { data } = await api.get(`/api/chat/sessions/${encodeURIComponent(active.session_id)}/messages`);
    setMessages(data);
    loadSessions();
  }

  async function rateReply(m: any, rating: number) {
    setMessages((xs) => xs.map((x) => (x.id === m.id ? { ...x, rating: rating === 0 ? null : rating } : x)));
    await api.post(`/api/chat/messages/${m.id}/rate`, { rating }).catch(() => {});
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
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-4">
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
                <button
                  title="Reset this guest completely — deletes chats, memory, orders and reservations so they start fresh (testing tool)"
                  onClick={async () => {
                    if (!confirm(`Fully reset ${active.diner_name || active.session_id}? This wipes their chats, memory, orders and reservations.`)) return;
                    await api.delete(`/api/chat/sessions/${encodeURIComponent(active.session_id)}/reset`).catch(() => {});
                    setActive(null);
                    setMessages([]);
                    setCtx(null);
                    loadSessions();
                  }}
                  className="mr-2 rounded-lg border border-red-500/40 px-2 py-1.5 text-xs text-red-400 hover:bg-red-500/10"
                >
                  🗑 Reset guest
                </button>
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
                      <div className="mt-0.5 flex items-center justify-end gap-1.5">
                        {m.sender === "ai" && (
                          <>
                            <button
                              title="Good reply"
                              onClick={() => rateReply(m, m.rating === 1 ? 0 : 1)}
                              className={`text-[11px] transition ${m.rating === 1 ? "opacity-100" : "opacity-30 hover:opacity-70"}`}
                            >👍</button>
                            <button
                              title="Bad reply — flag for review"
                              onClick={() => rateReply(m, m.rating === -1 ? 0 : -1)}
                              className={`text-[11px] transition ${m.rating === -1 ? "opacity-100" : "opacity-30 hover:opacity-70"}`}
                            >👎</button>
                          </>
                        )}
                        {m.created_at && (
                          <span className="text-[9px] opacity-40">
                            {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        )}
                      </div>
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

        <Card className="hidden overflow-y-auto p-4 lg:col-span-1 lg:block">
          {!active ? (
            <Empty text="Guest context" />
          ) : (
            <GuestPanel ctx={ctx} onSaved={() => loadContext(active.session_id)} />
          )}
        </Card>
      </div>
    </div>
  );
}

// What the AI knows about this guest — staff taking over should never be blind.
function GuestPanel({ ctx, onSaved }: { ctx: any; onSaved: () => void }) {
  const d = ctx?.diner;
  const s = ctx?.session;
  const [notes, setNotes] = useState("");
  useEffect(() => setNotes(d?.notes || ""), [d?.id]);
  if (!ctx) return <Empty text="Loading context…" />;

  const bdays = daysUntilMMDD(d?.preferences?.occasions?.birthday);
  const tier = !d || d.visit_count === 0 ? "New guest" : d.is_vip ? "VIP ⭐" : d.visit_count < 3 ? "Returning" : "Regular";
  const r = ctx.upcoming_reservation;

  return (
    <div className="space-y-4 text-sm">
      <div>
        <div className="text-base font-semibold">{d?.name || d?.wa_profile_name || s?.phone_number || s?.session_id}</div>
        <div className="text-xs text-zinc-500">{tier}{d ? ` · ${d.visit_count} visits` : ""}</div>
      </div>

      {d?.allergies?.length > 0 && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          ⚠️ Allergies: {d.allergies.join(", ")}
        </div>
      )}

      {bdays !== null && bdays <= 14 && (
        <div className="rounded-lg bg-fuchsia-500/10 px-3 py-2 text-xs text-fuchsia-300">
          🎂 Birthday {bdays === 0 ? "TODAY" : `in ${bdays} days`}
        </div>
      )}

      {s?.handoff_briefing && (
        <PanelBlock title="🤝 Handoff briefing"><span className="text-amber-300">{s.handoff_briefing}</span></PanelBlock>
      )}

      {r && (
        <PanelBlock title="Upcoming reservation">
          {r.code} · {r.date} {String(r.time_slot).slice(0, 5)} · {r.party_size}p{r.occasion && r.occasion !== "none" ? ` · ${r.occasion}` : ""}
        </PanelBlock>
      )}

      {d?.preferences?.favorite_items?.length > 0 && (
        <PanelBlock title="Favorite dishes">{d.preferences.favorite_items.join(", ")}</PanelBlock>
      )}
      {d?.preferences?.seating && <PanelBlock title="Prefers seating">{d.preferences.seating}</PanelBlock>}
      {d?.preferences?.facts?.length > 0 && (
        <PanelBlock title="Known about them">{d.preferences.facts.join(" · ")}</PanelBlock>
      )}
      {d?.preferences?.ai_notes?.length > 0 && (
        <PanelBlock title="🤖 AI observations">
          {d.preferences.ai_notes.map((n: string, i: number) => (
            <div key={i}>{n}</div>
          ))}
        </PanelBlock>
      )}
      {d?.tags?.length > 0 && <PanelBlock title="Tags">{d.tags.join(", ")}</PanelBlock>}
      {ctx.summary && <PanelBlock title="AI conversation summary">{ctx.summary}</PanelBlock>}

      {d && (
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">Staff notes (the bot obeys these)</div>
          <textarea
            className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-zinc-500"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <button
            className="mt-1 rounded-xl border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
            onClick={async () => { await api.patch(`/api/diners/${d.id}`, { notes }); onSaved(); }}
          >
            Save notes
          </button>
        </div>
      )}
    </div>
  );
}

function PanelBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">{title}</div>
      <div className="text-xs text-zinc-300">{children}</div>
    </div>
  );
}

function daysUntilMMDD(mmdd?: string): number | null {
  if (!/^\d{2}-\d{2}$/.test(mmdd || "")) return null;
  const [m, d] = (mmdd as string).split("-").map(Number);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(now.getFullYear(), m - 1, d);
  if (next < today) next = new Date(now.getFullYear() + 1, m - 1, d);
  return Math.round((next.getTime() - today.getTime()) / 86400000);
}
