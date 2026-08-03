import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Send, Bot, BotOff, Instagram, MessageCircle, Search, AlertCircle, ShoppingCart,
  Ticket, FileText, Sparkles, Trash2, User, ChevronDown, ChevronUp, Check, MapPin,
} from "lucide-react";
import { api } from "../config/api";
import { Card, PageHeader, Btn, Input, Empty } from "../components/ui";
import { markSeen, isUnread } from "../lib/unread";

// ---------- message-content rendering: show what the guest actually saw ----------

const RULE = /^[―ー–—\-]{6,}\s*$/;
const bold = (s: string) =>
  s.split(/\*([^*\n]+)\*/g).map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part));

function linkify(s: string, key: number) {
  const m = s.match(/https?:\/\/\S+/);
  if (!m) return <span key={key}>{bold(s)}</span>;
  const [url] = m;
  const [before, after] = [s.slice(0, m.index), s.slice((m.index || 0) + url.length)];
  return (
    <span key={key}>
      {bold(before)}
      <a href={url} target="_blank" rel="noreferrer" className="underline decoration-dotted underline-offset-2">{url.replace(/^https?:\/\//, "").slice(0, 40)}</a>
      {bold(after)}
    </span>
  );
}

// a bill section between two rule lines → mini thermal card
function ReceiptCard({ lines }: { lines: string[] }) {
  return (
    <div className="my-1.5 rounded-lg bg-[#fbfaf4] px-3 py-2 font-mono text-[12px] leading-relaxed text-neutral-900">
      {lines.map((l, i) => {
        const item = l.match(/^[•\-]\s*(.+?)\s+—\s+(.+)$/);
        if (item) {
          return (
            <div key={i} className="flex justify-between gap-3">
              <span>{item[1]}</span>
              <span className="shrink-0 tabular-nums text-neutral-600">{item[2]}</span>
            </div>
          );
        }
        const kv = l.match(/^([A-Za-z ()%.0-9]+):\s+(.+)$/);
        if (kv && /subtotal|total|vat|service|delivery|payment/i.test(kv[1])) {
          const strong = /^total/i.test(kv[1]);
          return (
            <div key={i} className={`flex justify-between gap-3 ${strong ? "mt-1 border-t border-dashed border-neutral-400 pt-1 font-bold" : "text-neutral-700"}`}>
              <span>{kv[1]}</span>
              <span className="shrink-0 tabular-nums">{kv[2]}</span>
            </div>
          );
        }
        return <div key={i} className={/🧾|\*YOUR ORDER\*/.test(l) ? "mb-1 font-bold tracking-wide" : ""}>{bold(l.replace(/\*/g, ""))}</div>;
      })}
    </div>
  );
}

function MessageBody({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const lines = String(text || "").split("\n");

  // segment: receipt blocks between rule lines vs everything else
  const segments: { kind: "text" | "receipt"; lines: string[] }[] = [];
  let cur: string[] = [];
  let inReceipt = false;
  for (const l of lines) {
    if (RULE.test(l.trim())) {
      segments.push({ kind: inReceipt ? "receipt" : "text", lines: cur });
      cur = [];
      inReceipt = !inReceipt;
      continue;
    }
    cur.push(l);
  }
  segments.push({ kind: inReceipt ? "receipt" : "text", lines: cur });

  const totalLines = lines.length;
  const collapsed = totalLines > 14 && !open;
  let budget = collapsed ? 10 : Infinity;

  const out: React.ReactNode[] = [];
  segments.forEach((seg, si) => {
    if (budget <= 0) return;
    if (seg.kind === "receipt") {
      out.push(<ReceiptCard key={`r${si}`} lines={seg.lines.filter((l) => l.trim())} />);
      budget -= seg.lines.length;
      return;
    }
    const shown = seg.lines.slice(0, Math.max(0, budget));
    budget -= seg.lines.length;
    let listBuf: string[] = [];
    const flush = (k: string) => {
      if (!listBuf.length) return;
      out.push(
        <ul key={k} className="my-0.5 space-y-0.5">
          {listBuf.map((b, bi) => (
            <li key={bi} className="flex gap-1.5"><span className="text-zinc-500">•</span><span>{bold(b)}</span></li>
          ))}
        </ul>
      );
      listBuf = [];
    };
    shown.forEach((l, li) => {
      const t = l.trim();
      const bullet = t.match(/^[•\-]\s+(.+)$/);
      if (bullet) { listBuf.push(bullet[1]); return; }
      flush(`l${si}-${li}`);
      if (!t) { out.push(<div key={`s${si}-${li}`} className="h-1.5" />); return; }
      if (/^📄/.test(t)) {
        const url = t.match(/https?:\/\/\S+/)?.[0];
        out.push(
          <a key={`f${si}-${li}`} href={url} target="_blank" rel="noreferrer"
            className="my-1 flex w-fit items-center gap-2 rounded-lg border border-zinc-600/50 bg-zinc-900/40 px-2.5 py-1.5 text-xs font-medium hover:bg-zinc-900">
            <FileText size={14} /> {t.replace(/https?:\/\/\S+/, "").replace(/^📄\s*/, "").replace(/:\s*$/, "") || "Document"} — open
          </a>
        );
        return;
      }
      out.push(<div key={`t${si}-${li}`}>{linkify(t, li)}</div>);
    });
    flush(`l${si}-end`);
  });

  return (
    <div className="space-y-0.5 text-sm leading-relaxed">
      {out}
      {totalLines > 14 && (
        <button onClick={() => setOpen(!open)} className="mt-1 flex items-center gap-1 text-[11px] font-medium text-zinc-400 hover:text-zinc-200">
          {open ? <><ChevronUp size={12} /> show less</> : <><ChevronDown size={12} /> show more ({totalLines - 10} lines)</>}
        </button>
      )}
    </div>
  );
}

// guest message that repeats an option from the previous bot message = a "tap"
const BUTTONISH = /^(dine.?in|pickup|pick.?up|delivery|cash|card|instapay|confirm( ✅)?|change something)$/i;
function isTap(msg: string, prevBot: string | null) {
  const t = msg.trim();
  if (t.length > 26) return false;
  if (BUTTONISH.test(t)) return true;
  if (!prevBot) return false;
  const options = [...prevBot.matchAll(/^[•\-]\s+(.+)$/gm)].map((m) => m[1].trim().toLowerCase());
  return options.includes(t.toLowerCase());
}

// ---------- day separators + milestones ----------

function dayLabel(d: Date) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that = new Date(d); that.setHours(0, 0, 0, 0);
  const diff = (today.getTime() - that.getTime()) / 86400000;
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

type Row =
  | { kind: "msg"; m: any; parts: any[] }
  | { kind: "day"; label: string; key: string }
  | { kind: "milestone"; label: string; key: string };

function buildRows(messages: any[], orders: any[]): Row[] {
  const events = (orders || []).map((o) => ({
    at: o.created_at,
    label: `Order ${o.code} placed — EGP ${Number(o.total).toLocaleString()}${o.branch ? ` · ${o.branch}` : ""}${o.status && !["pending", "accepted"].includes(o.status) ? ` · now ${o.status}` : ""}`,
  }));
  const rows: Row[] = [];
  let lastDay = "";
  let ev = 0;
  const sortedEv = events.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const pushDay = (at: string) => {
    const label = dayLabel(new Date(at));
    if (label !== lastDay) { rows.push({ kind: "day", label, key: `d${at}` }); lastDay = label; }
  };
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    while (ev < sortedEv.length && String(sortedEv[ev].at) <= String(m.created_at)) {
      pushDay(sortedEv[ev].at);
      rows.push({ kind: "milestone", label: sortedEv[ev].label, key: `e${ev}` });
      ev++;
    }
    pushDay(m.created_at);
    // group consecutive AI messages sent within 25s into one bubble
    if (m.sender === "ai") {
      const parts = [m];
      while (
        i + 1 < messages.length && messages[i + 1].sender === "ai" &&
        new Date(messages[i + 1].created_at).getTime() - new Date(parts[parts.length - 1].created_at).getTime() < 25000
      ) { parts.push(messages[++i]); }
      rows.push({ kind: "msg", m, parts });
    } else {
      rows.push({ kind: "msg", m, parts: [m] });
    }
  }
  while (ev < sortedEv.length) { rows.push({ kind: "milestone", label: sortedEv[ev].label, key: `e${ev}` }); ev++; }
  return rows;
}

const SNIPPETS = [
  "Ahlan! How can we help? 😄",
  "So sorry about that 🙏 We're on it right now.",
  "Your order is on its way! 🛵",
  "We'll call you in a minute to sort this out 📞",
];

// ---------- page ----------

export default function Chats() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [active, setActive] = useState<any | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [text, setText] = useState("");
  const [ctx, setCtx] = useState<any | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [aiName, setAiName] = useState("AI");
  const [drafting, setDrafting] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const nav = useNavigate();

  const loadContext = (sessionId: string) =>
    api.get(`/api/chat/sessions/${encodeURIComponent(sessionId)}/context`).then((r) => setCtx(r.data)).catch(() => setCtx(null));

  const loadSessions = () =>
    api.get("/api/chat/sessions").then((r) => {
      const rows = [...r.data].sort((a: any, b: any) =>
        (b.needs_attention ? 1 : 0) - (a.needs_attention ? 1 : 0) ||
        String(b.last_message_at || "").localeCompare(String(a.last_message_at || ""))
      );
      setSessions(rows);
    }).catch(() => {});

  useEffect(() => {
    loadSessions();
    api.get("/api/settings").then((r) => setAiName(r.data?.ai?.name || "AI")).catch(() => {});
    const t = setInterval(loadSessions, 10000);
    return () => clearInterval(t);
  }, []);

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
    markSeen(active.session_id);
    window.dispatchEvent(new Event("chat-seen"));
    const load = () =>
      api.get(`/api/chat/sessions/${encodeURIComponent(active.session_id)}/messages`).then((r) => {
        setMessages(r.data);
        markSeen(active.session_id);
      }).catch(() => {});
    load();
    loadContext(active.session_id);
    const t = setInterval(load, 5000);
    const tc = setInterval(() => loadContext(active.session_id), 20000);
    return () => { clearInterval(t); clearInterval(tc); };
  }, [active?.session_id]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || !active) return;
    await api.post(`/api/chat/sessions/${encodeURIComponent(active.session_id)}/messages`, { message: text });
    setText("");
    if (active.ai_enabled) setActive({ ...active, ai_enabled: false });
    const { data } = await api.get(`/api/chat/sessions/${encodeURIComponent(active.session_id)}/messages`);
    setMessages(data);
    loadSessions();
  }

  async function draftReply() {
    if (!active || drafting) return;
    setDrafting(true);
    try {
      const { data } = await api.post(`/api/chat/sessions/${encodeURIComponent(active.session_id)}/draft-reply`);
      if (data?.draft) setText(data.draft);
    } catch { /* flows offline — staff types manually */ }
    setDrafting(false);
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

  function jumpToOrder(code: string) {
    const target = messages.find((m) => String(m.message || "").includes(code));
    if (target) {
      setHighlight(String(target.id));
      document.getElementById(`msg-${target.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => setHighlight(null), 2500);
    } else {
      nav("/orders");
    }
  }

  const filtered = useMemo(() => {
    let rows = sessions;
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      rows = rows.filter((s) =>
        (s.diner_name || "").toLowerCase().includes(needle) ||
        (s.phone_number || s.session_id || "").toLowerCase().includes(needle) ||
        (s.last_message || "").toLowerCase().includes(needle));
    }
    if (filter === "attention") rows = rows.filter((s) => s.needs_attention);
    if (filter === "takenover") rows = rows.filter((s) => !s.ai_enabled);
    if (filter === "ordering") rows = rows.filter((s) => s.draft_stage);
    return rows;
  }, [sessions, q, filter]);

  const rows = useMemo(() => buildRows(messages, ctx?.orders || []), [messages, ctx?.orders]);

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Chats" subtitle="WhatsApp & Instagram conversations — take over from the AI any time" />
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-4">
        {/* -------- session list -------- */}
        <Card className="flex min-h-0 flex-col lg:col-span-1">
          <div className="border-b border-zinc-800 p-2.5">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search name, phone, text…"
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 py-1.5 pl-8 pr-2 text-xs text-zinc-100 outline-none focus:border-zinc-600"
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {[["all", "All"], ["attention", "Attention"], ["takenover", "Taken over"], ["ordering", "Ordering"]].map(([k, label]) => (
                <button key={k} onClick={() => setFilter(k)}
                  className={`rounded-full px-2 py-0.5 text-[11px] transition ${filter === k ? "bg-zinc-200 font-semibold text-zinc-900" : "bg-zinc-800/70 text-zinc-400 hover:text-zinc-200"}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <Empty text="No conversations" />
            ) : (
              filtered.map((s) => {
                const unread = isUnread(s) && active?.session_id !== s.session_id;
                return (
                  <button
                    key={s.id}
                    onClick={() => setActive(s)}
                    className={`flex w-full items-start gap-2.5 border-b border-zinc-800/60 px-3.5 py-3 text-left transition hover:bg-zinc-900 ${active?.id === s.id ? "bg-zinc-900" : ""}`}
                  >
                    <div className="mt-0.5 text-zinc-500">
                      {s.channel === "instagram" ? <Instagram size={15} /> : <MessageCircle size={15} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`truncate text-sm ${unread ? "font-bold" : "font-medium"}`}>{s.diner_name || s.phone_number || s.session_id}</span>
                        <span className="flex shrink-0 items-center gap-1">
                          {s.needs_attention && <AlertCircle size={13} className="text-amber-400" />}
                          {unread && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: "var(--accent)" }} />}
                        </span>
                      </div>
                      <div className={`truncate text-xs ${unread ? "text-zinc-300" : "text-zinc-500"}`}>{s.last_message}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {s.draft_stage && (
                          <span className="flex items-center gap-1 rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-300">
                            <ShoppingCart size={10} /> {s.draft_stage}
                          </span>
                        )}
                        {!s.draft_stage && s.last_order && (
                          <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
                            <Ticket size={10} /> {s.last_order.code}
                          </span>
                        )}
                        {!s.ai_enabled && (
                          <span className="flex items-center gap-1 rounded-full bg-zinc-700/60 px-1.5 py-0.5 text-[10px] text-zinc-300">
                            <User size={10} /> staff
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </Card>

        {/* -------- thread -------- */}
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
                    <div className="mt-0.5 max-w-md text-xs text-zinc-400">Handoff: {active.handoff_briefing}</div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    title="Reset this guest completely — deletes chats, memory, orders and reservations so they start fresh (testing tool)"
                    onClick={async () => {
                      if (!confirm(`Fully reset ${active.diner_name || active.session_id}? This wipes their chats, memory, orders and reservations.`)) return;
                      await api.delete(`/api/chat/sessions/${encodeURIComponent(active.session_id)}/reset`).catch(() => {});
                      setActive(null); setMessages([]); setCtx(null); loadSessions();
                    }}
                    className="rounded-lg border border-red-500/40 p-2 text-red-400 hover:bg-red-500/10"
                  ><Trash2 size={14} /></button>
                  <Btn variant={active.ai_enabled ? "ghost" : "primary"} className="px-3 py-1.5 text-xs" onClick={toggleAi}>
                    <span className="flex items-center gap-1.5">
                      {active.ai_enabled ? <><Bot size={14} /> AI on — take over</> : <><BotOff size={14} /> Hand back to AI</>}
                    </span>
                  </Btn>
                </div>
              </div>

              {!active.ai_enabled && (
                <div className="flex items-center justify-between gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-xs text-zinc-200">
                  <span className="flex items-center gap-1.5"><User size={12} /> AI paused — you're talking to the guest directly.</span>
                  <button onClick={toggleAi} className="font-semibold underline underline-offset-2">Hand back</button>
                </div>
              )}

              <div ref={threadRef} className="flex-1 space-y-2 overflow-y-auto p-4">
                {rows.map((row, ri) => {
                  if (row.kind === "day") {
                    return (
                      <div key={row.key} className="flex justify-center py-1">
                        <span className="rounded-full bg-zinc-800/80 px-2.5 py-0.5 text-[10px] font-medium text-zinc-400">{row.label}</span>
                      </div>
                    );
                  }
                  if (row.kind === "milestone") {
                    return (
                      <div key={row.key} className="flex items-center gap-2 py-1">
                        <div className="h-px flex-1 bg-zinc-800" />
                        <span className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-400"><Ticket size={12} /> {row.label}</span>
                        <div className="h-px flex-1 bg-zinc-800" />
                      </div>
                    );
                  }
                  const { m, parts } = row;
                  const prevBotMsg = [...messages.slice(0, messages.indexOf(m))].reverse().find((x) => x.sender !== "guest")?.message || null;
                  if (m.sender === "guest" && isTap(m.message || "", prevBotMsg)) {
                    return (
                      <div key={m.id} id={`msg-${m.id}`} className="flex justify-start">
                        <span className="flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-800/60 px-3 py-1 text-xs text-zinc-300">
                          <Check size={12} className="text-emerald-400" /> {m.message}
                        </span>
                      </div>
                    );
                  }
                  return (
                    <div key={m.id} id={`msg-${m.id}`} className={`flex ${m.sender === "guest" ? "justify-start" : "justify-end"}`}>
                      <div
                        className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-sm text-zinc-100 transition-shadow ${
                          highlight === String(m.id) ? "ring-2 ring-amber-400" : ""
                        } ${m.sender === "guest" ? "bg-zinc-800" : m.sender === "ai" ? "bg-amber-500/15" : "bg-sky-500/20"}`}
                      >
                        {m.sender !== "guest" && (
                          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide opacity-70">
                            {m.sender === "ai" ? <><Bot size={11} /> {aiName}</> : <><User size={11} /> Staff</>}
                          </div>
                        )}
                        {parts.map((p: any, pi: number) => (
                          <div key={p.id} className={pi > 0 ? "mt-2 border-t border-zinc-700/40 pt-2" : ""}>
                            {p.media_url && p.media_type === "image" && (
                              <img src={p.media_url} alt="" className="mb-1.5 max-h-52 rounded-xl" />
                            )}
                            {p.media_url && p.media_type === "audio" && (
                              <audio controls src={p.media_url} className="mb-1.5 h-9 w-56" />
                            )}
                            {p.media_url && p.media_type === "document" && (
                              <a href={p.media_url} target="_blank" rel="noreferrer"
                                className="mb-1.5 flex w-fit items-center gap-2 rounded-lg border border-zinc-600/50 bg-zinc-900/40 px-2.5 py-1.5 text-xs font-medium hover:bg-zinc-900">
                                <FileText size={14} /> Document — open
                              </a>
                            )}
                            <MessageBody text={p.message} />
                          </div>
                        ))}
                        <div className="mt-1 flex items-center justify-end gap-1.5">
                          {m.sender === "ai" && (
                            <>
                              <button title="Good reply" onClick={() => rateReply(m, m.rating === 1 ? 0 : 1)}
                                className={`text-[11px] transition ${m.rating === 1 ? "opacity-100" : "opacity-30 hover:opacity-70"}`}>👍</button>
                              <button title="Bad reply — flag for review" onClick={() => rateReply(m, m.rating === -1 ? 0 : -1)}
                                className={`text-[11px] transition ${m.rating === -1 ? "opacity-100" : "opacity-30 hover:opacity-70"}`}>👎</button>
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
                  );
                })}
                <div ref={bottomRef} />
              </div>

              <div className="border-t border-zinc-800 p-3">
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {SNIPPETS.map((s) => (
                    <button key={s} onClick={() => setText(s)}
                      className="rounded-full border border-zinc-700/70 px-2.5 py-1 text-[11px] text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-200">
                      {s.length > 34 ? s.slice(0, 32) + "…" : s}
                    </button>
                  ))}
                  <button onClick={draftReply} disabled={drafting}
                    className="flex items-center gap-1 rounded-full border border-zinc-600 px-2.5 py-1 text-[11px] font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-50">
                    <Sparkles size={11} /> {drafting ? "drafting…" : "AI draft"}
                  </button>
                </div>
                <form onSubmit={send} className="flex gap-2">
                  <Input className="flex-1" placeholder="Reply as staff…" value={text} onChange={(e) => setText(e.target.value)} />
                  <Btn type="submit"><Send size={15} /></Btn>
                </form>
              </div>
            </>
          )}
        </Card>

        {/* -------- guest panel -------- */}
        <Card className="hidden overflow-y-auto p-4 lg:col-span-1 lg:block">
          {!active ? (
            <Empty text="Guest context" />
          ) : (
            <GuestPanel ctx={ctx} onSaved={() => loadContext(active.session_id)} onOrderClick={jumpToOrder} />
          )}
        </Card>
      </div>
    </div>
  );
}

// ---------- guest panel ----------

const DRAFT_STEPS = ["Items", "Options", "Details", "Payment", "Confirm"];
function draftStep(stage: string | null | undefined, orderType: string | null | undefined): number {
  if (!stage) return 0;
  if (stage === "building") return orderType ? 3 : 1;
  if (stage === "choosing options") return 2;
  if (stage === "confirming") return 4;
  return 5; // awaiting confirmation
}

function GuestPanel({ ctx, onSaved, onOrderClick }: { ctx: any; onSaved: () => void; onOrderClick: (code: string) => void }) {
  const d = ctx?.diner;
  const s = ctx?.session;
  const [notes, setNotes] = useState("");
  useEffect(() => { setNotes(d?.notes || ""); }, [d?.id]);
  if (!ctx) return <Empty text="Loading context…" />;

  const bdays = daysUntilMMDD(d?.preferences?.occasions?.birthday);
  const tier = !d || d.visit_count === 0 ? "New guest" : d.is_vip ? "VIP ⭐" : d.visit_count < 3 ? "Returning" : "Regular";
  const r = ctx.upcoming_reservation;
  const step = draftStep(ctx.draft?.stage, ctx.draft?.order_type);

  return (
    <div className="space-y-4 text-sm">
      <div>
        <div className="text-base font-semibold">{d?.name || d?.wa_profile_name || s?.phone_number || s?.session_id}</div>
        <div className="text-xs text-zinc-500">{tier}{d ? ` · ${d.visit_count} visits` : ""}{d?.total_spend > 0 ? ` · EGP ${Number(d.total_spend).toLocaleString()} lifetime` : ""}</div>
        <div className="mt-1 space-y-0.5 text-xs text-zinc-400">
          <div>{d?.phone_number || s?.session_id}</div>
          {d?.wa_profile_name && d?.name && d.wa_profile_name !== d.name && <div>WhatsApp name: {d.wa_profile_name}</div>}
          {d?.last_seen_at && <div>Last seen: {new Date(d.last_seen_at).toLocaleString()}</div>}
          {d?.preferred_branch && <div>Usual branch: {d.preferred_branch}</div>}
        </div>
      </div>

      {ctx.draft && (
        <div className="rounded-lg border border-sky-500/50 bg-sky-500/10 px-3 py-2 text-xs text-zinc-200">
          <div className="flex items-center gap-1.5 font-semibold"><ShoppingCart size={12} /> Order in progress</div>
          <div className="mt-1">{ctx.draft.items}{ctx.draft.order_type ? ` · ${String(ctx.draft.order_type).replace("_", "-")}` : ""}{ctx.draft.branch ? ` · ${ctx.draft.branch}` : ""}</div>
          {/* items → options → details → payment → confirm, lit to the current stage */}
          <div className="mt-2 flex items-center gap-1">
            {DRAFT_STEPS.map((label, i) => (
              <div key={label} className="flex-1">
                <div className={`h-1 rounded-full ${i < step ? "bg-sky-400" : "bg-zinc-700"}`} />
                <div className={`mt-0.5 text-center text-[8px] ${i < step ? "text-sky-300" : "text-zinc-600"}`}>{label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {(ctx.order_stats?.lifetime_egp > 0 || ctx.order_stats?.usual) && (
        <PanelBlock title="Ordering profile">
          {ctx.order_stats.usual && <div>Their usual: <b>{ctx.order_stats.usual.name}</b> (×{ctx.order_stats.usual.times})</div>}
          {ctx.order_stats.lifetime_egp > 0 && <div>Lifetime spend: EGP {Number(ctx.order_stats.lifetime_egp).toLocaleString()}</div>}
        </PanelBlock>
      )}

      {ctx.saved_addresses?.length > 0 && (
        <PanelBlock title="Saved delivery addresses">
          {ctx.saved_addresses.map((a: any, i: number) => (
            <div key={i} className="flex items-start gap-1"><MapPin size={11} className="mt-0.5 shrink-0 text-zinc-500" /> {a.text}{a.last_used ? <span className="text-zinc-500"> · {String(a.last_used).slice(0, 10)}</span> : null}</div>
          ))}
        </PanelBlock>
      )}

      {ctx.orders?.length > 0 && (
        <PanelBlock title={`Recent orders (${ctx.orders.length})`}>
          {ctx.orders.map((o: any, i: number) => (
            <button key={i} onClick={() => onOrderClick(o.code)} className="mb-1 block w-full rounded-md px-1 py-0.5 text-left transition hover:bg-zinc-800/60">
              <span className="font-mono font-semibold text-zinc-200">{o.code}</span>
              {" "}<span className={o.status === "cancelled" ? "text-red-400" : "text-zinc-400"}>{o.status}</span>
              {" · "}EGP {Number(o.total).toLocaleString()} · {String(o.order_type || "").replace("_", "-")}
              <div className="text-zinc-500">{o.items}</div>
            </button>
          ))}
        </PanelBlock>
      )}

      {d?.allergies?.length > 0 && (
        <div className="rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-2 text-xs font-medium text-zinc-200">
          <AlertCircle size={12} className="mr-1 inline text-red-400" /> Allergies: {d.allergies.join(", ")}
        </div>
      )}

      {bdays !== null && bdays <= 14 && (
        <div className="rounded-lg border border-fuchsia-500/50 bg-fuchsia-500/10 px-3 py-2 text-xs text-zinc-200">
          Birthday {bdays === 0 ? "TODAY" : `in ${bdays} days`} 🎂
        </div>
      )}

      {s?.handoff_briefing && (
        <PanelBlock title="Handoff briefing"><span className="text-zinc-200">{s.handoff_briefing}</span></PanelBlock>
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
        <PanelBlock title="AI observations">
          {d.preferences.ai_notes.map((n: string, i: number) => (
            <div key={i}>{n}</div>
          ))}
        </PanelBlock>
      )}
      {d?.tags?.length > 0 && <PanelBlock title="Tags">{d.tags.join(", ")}</PanelBlock>}

      {ctx.summary && <PanelBlock title="AI conversation summary">{ctx.summary}</PanelBlock>}

      {d && (
        <PanelBlock title="Staff notes (the bot reads these)">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-2 text-xs text-zinc-100 outline-none focus:border-zinc-600"
          />
          <button
            onClick={async () => { await api.patch(`/api/diners/${d.id}`, { notes }).catch(() => {}); onSaved(); }}
            className="mt-1 rounded-lg bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-900"
          >Save note</button>
        </PanelBlock>
      )}
    </div>
  );
}

function PanelBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</div>
      <div className="space-y-0.5 text-xs text-zinc-300">{children}</div>
    </div>
  );
}

function daysUntilMMDD(mmdd?: string | null): number | null {
  if (!mmdd || !/^\d{2}-\d{2}$/.test(mmdd)) return null;
  const [mm, dd] = mmdd.split("-").map(Number);
  const now = new Date();
  let next = new Date(now.getFullYear(), mm - 1, dd);
  if (next < new Date(now.getFullYear(), now.getMonth(), now.getDate())) next = new Date(now.getFullYear() + 1, mm - 1, dd);
  return Math.round((next.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86400000);
}
