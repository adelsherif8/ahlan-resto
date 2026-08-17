import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Send, Bot, BotOff, Instagram, MessageCircle, Search, AlertCircle, ShoppingCart,
  Ticket, FileText, Sparkles, Trash2, User, ChevronDown, ChevronUp, Check, MapPin,
  ThumbsUp, ThumbsDown, ChevronRight,
} from "lucide-react";
import { api } from "../config/api";
import { Card, PageHeader, Btn, Input, Empty } from "../components/ui";
import { markSeen, isUnread } from "../lib/unread";
import { money } from "../lib/format";
import { usePoll } from "../lib/usePoll";
import BackLink, { backTrip } from "../components/BackLink";

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
      {lines.map((raw, i) => {
        const l = raw.replace(/\*/g, "");
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
        return <div key={i} className={/🧾|YOUR ORDER|RECEIPT/.test(l) ? "mb-1 font-bold tracking-wide" : ""}>{bold(l)}</div>;
      })}
    </div>
  );
}

// bill totals live right after the ruled section — pull them into the card so
// the receipt reads as one piece of paper, not a card plus stray lines
const MONEY_LINE = /^\*?(Subtotal|Service|VAT|Delivery|TOTAL)\b[^:]*:/i;

function MessageBody({ text, mediaUrl }: { text: string; mediaUrl?: string | null }) {
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

  // totals that follow the ruled items section get pulled into the card
  for (let i = 0; i + 1 < segments.length; i++) {
    if (segments[i].kind !== "receipt" || segments[i + 1].kind !== "text") continue;
    const nxt = segments[i + 1].lines;
    while (nxt.length && (!nxt[0].trim() || MONEY_LINE.test(nxt[0].trim()))) {
      const ln = nxt.shift()!;
      if (ln.trim()) segments[i].lines.push(ln);
    }
  }

  const hasFileTile = lines.some((l) => /^📄/.test(l.trim())) || !!mediaUrl;
  // collapse counts PLAIN text only — a bill must never be cut in half
  const textLineCount = segments.filter((s) => s.kind === "text").reduce((n, s) => n + s.lines.filter((l) => l.trim()).length, 0);
  const collapsible = textLineCount > 14;
  let budget = collapsible && !open ? 10 : Infinity;

  const out: React.ReactNode[] = [];
  segments.forEach((seg, si) => {
    if (seg.kind === "receipt") {
      out.push(<ReceiptCard key={`r${si}`} lines={seg.lines.filter((l) => l.trim())} />);
      return;
    }
    if (budget <= 0) return;
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
      // a bare URL duplicating a file tile or the attached document adds nothing
      if (/^https?:\/\/\S+$/.test(t) && hasFileTile) return;
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
      {collapsible && (
        <button onClick={() => setOpen(!open)} className="mt-1 flex items-center gap-1 text-xs font-medium text-zinc-400 hover:text-zinc-200">
          {open ? <><ChevronUp size={12} /> show less</> : <><ChevronDown size={12} /> show more ({textLineCount - 10} lines)</>}
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

function relTime(ts?: string | null): string {
  if (!ts) return "";
  const s = (Date.now() - new Date(ts).getTime()) / 1000;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

const ORDER_CHIP: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-300",
  accepted: "bg-amber-500/15 text-amber-300",
  preparing: "bg-orange-500/15 text-orange-300",
  ready: "bg-sky-500/15 text-sky-300",
};

// Fallback only. The real list is per-restaurant config (ai.snippets, edited in
// Settings → AI host → Staff quick replies) — canned replies are a restaurant's voice,
// and hardcoding four English lines here gave every restaurant the same one and let
// none of them change it. Deliberately plain: a restaurant that has not written its
// own should not be putting words in its guests' faces that it never chose.
// Fixed vocabulary so Bot quality can COUNT causes. Free text can't be grouped, which is
// why "why did it hand over" was previously a list of one-off sentences.
const HANDOFF_TAGS = ["menu gap", "complaint", "custom request", "payment", "bot confused", "other"];

const FALLBACK_SNIPPETS = [
  "Hi! How can we help?",
  "Sorry about that — we're on it right now.",
  "Your order is on its way.",
  "We'll call you in a minute to sort this out.",
];

// {name} / {order} are filled from the open conversation. A snippet whose placeholder
// has no value is dropped rather than sent with a hole in it — "Hi {name}!" reaching a
// guest verbatim is worse than not offering the shortcut at all.
function fillSnippet(t: string, vars: { name?: string | null; order?: string | null }): string | null {
  let out = t;
  for (const [key, val] of Object.entries(vars)) {
    const token = `{${key}}`;
    if (!out.includes(token)) continue;
    if (!val) return null;
    out = out.replaceAll(token, String(val));
  }
  return out;
}

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
  const [undo, setUndo] = useState<{ label: string; run: () => void } | null>(null);
  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 7000);
    return () => clearTimeout(t);
  }, [undo]);

  // past answers to whatever the guest just asked — staff have usually written a good
  // one already and had no way to find it
  const [past, setPast] = useState<any[]>([]);
  const [showPast, setShowPast] = useState(false);
  // quick replies are this restaurant's own words, loaded from config
  const [rawSnippets, setRawSnippets] = useState<string[]>([]);
  useEffect(() => {
    api.get("/api/settings")
      .then((r) => setRawSnippets((r.data?.ai?.snippets || []).filter((x: any) => String(x || "").trim())))
      .catch(() => {});
  }, []);
  const [armReset, setArmReset] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const nav = useNavigate();

  const loadContext = (sessionId: string) =>
    api.get(`/api/chat/sessions/${encodeURIComponent(sessionId)}/context`).then((r) => setCtx(r.data)).catch(() => setCtx(null));

  // The inbox returns the 300 most recent conversations; searching asks for the wider set
  // so an older guest is still findable. Without this, typing a name that isn't in the
  // recent window would silently return nothing.
  const loadSessions = () =>
    api.get("/api/chat/sessions", { params: q.trim() ? { all: 1 } : {} }).then((r) => {
      const rows = [...r.data].sort((a: any, b: any) =>
        (b.needs_attention ? 1 : 0) - (a.needs_attention ? 1 : 0) ||
        String(b.last_message_at || "").localeCompare(String(a.last_message_at || ""))
      );
      setSessions(rows);
    }).catch(() => {});

  useEffect(() => {
    api.get("/api/settings").then((r) => setAiName(r.data?.ai?.name || "AI")).catch(() => {});
  }, []);
  usePoll(loadSessions, 10000, [q.trim() ? 1 : 0]);

  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const want = params.get("session");
    if (want && !active && sessions.length) {
      const s = sessions.find((x) => x.session_id === want || x.phone_number === want);
      if (s) setActive(s);
    }
    // ?filter=attention — arriving from an Overview alert. Apply the filter AND open the
    // one that has waited longest, because "2 conversations need a human" should land you
    // in the conversation, not in front of a list you still have to triage.
    const wantFilter = params.get("filter");
    if (wantFilter) {
      setFilter(wantFilter);
      if (wantFilter === "attention" && !active && sessions.length) {
        const worst = sessions
          .filter((s) => s.needs_attention)
          .sort((a, b) => (b.waiting_min ?? 0) - (a.waiting_min ?? 0))[0];
        if (worst) setActive(worst);
      }
      // consume it — left in the URL, the sessions poll re-applied it every 10s and
      // staff could never switch away from the filter they arrived on
      params.delete("filter");
      setParams(params, { replace: true });
    }
  }, [sessions, params]);

  // ?msg=123 — sent here to look at one specific reply (a 👎 from Bot quality). Scroll to
  // it and flash it, the same way the board rings a ticket, so nobody has to hunt.
  useEffect(() => {
    const wantMsg = params.get("msg");
    if (!wantMsg || !messages.length) return;
    if (!messages.some((m) => String(m.id) === wantMsg)) return;
    setHighlight(wantMsg);
    setTimeout(() => document.getElementById(`msg-${wantMsg}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 120);
    const t = setTimeout(() => setHighlight(null), 4000);
    return () => clearTimeout(t);
  }, [messages, params]);

  const loadMessages = useCallback((sid: string) =>
    api.get(`/api/chat/sessions/${encodeURIComponent(sid)}/messages`).then((r) => {
      setMessages(r.data);
      markSeen(sid);
    }).catch(() => {}), []);

  useEffect(() => {
    if (!active) return;
    markSeen(active.session_id);
    window.dispatchEvent(new Event("chat-seen"));
    loadContext(active.session_id);
  }, [active?.session_id]);
  usePoll(() => { if (active) loadMessages(active.session_id); }, 5000, [active?.session_id]);
  usePoll(() => { if (active) loadContext(active.session_id); }, 20000, [active?.session_id]);

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
    const was = active;
    await api.patch(`/api/chat/sessions/${active.id}`, { ai_enabled: next });
    setActive({ ...active, ai_enabled: next });
    loadSessions();
    // Undo instead of a confirm: it doesn't interrupt, and it forgives the wrong tap on
    // a tablet mid-service — which is when this actually gets pressed by mistake.
    setUndo({
      label: next ? "Handed back to the AI" : "You've taken over",
      run: async () => {
        await api.patch(`/api/chat/sessions/${was.id}`, { ai_enabled: was.ai_enabled }).catch(() => {});
        setActive({ ...was });
        loadSessions();
      },
    });
  }

  // pick why the bot handed over — a fixed vocabulary, so Bot quality can rank causes
  // instead of collecting free text nobody can group
  async function tagOutcome(reason: string) {
    if (!active) return;
    await api.patch(`/api/chat/sessions/${active.id}`, { handoff_reason: reason }).catch(() => {});
    setActive({ ...active, handoff_reason: reason });
    loadSessions();
  }

  function jumpToOrder(code: string) {
    // the moment it was placed usually IS in this thread — jump there first, since the
    // surrounding conversation is the context staff actually want
    const target = messages.find((m) => String(m.message || "").includes(code));
    if (target) {
      setHighlight(String(target.id));
      document.getElementById(`msg-${target.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => setHighlight(null), 2500);
    } else {
      // not in the transcript → hand the code to the board so it lands on the ticket
      nav(`/orders?code=${encodeURIComponent(code)}`,
        backTrip(`/chats?session=${encodeURIComponent(active?.session_id || "")}`, `${active?.diner_name || "this"} chat`));
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
    // Triage order: anyone actually waiting on a human comes first, longest wait at the
    // top — a queue sorted purely by recency buries the guest who has waited 40 minutes
    // under someone who just said "hi". Everything else keeps newest-first.
    return [...rows].sort((a, b) => {
      const aw = a.needs_attention ? a.waiting_min ?? 0 : -1;
      const bw = b.needs_attention ? b.waiting_min ?? 0 : -1;
      if (aw !== bw) return bw - aw;
      return String(b.last_message_at || "").localeCompare(String(a.last_message_at || ""));
    });
  }, [sessions, q, filter]);

  const rows = useMemo(() => buildRows(messages, ctx?.orders || []), [messages, ctx?.orders]);

  // the guest's most recent message is the question we look up
  const lastGuestMsg = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].sender === "guest") return String(messages[i].message || "");
    return "";
  }, [messages]);
  useEffect(() => {
    const q = lastGuestMsg.trim().slice(0, 60);
    if (!active || q.length < 6) { setPast([]); return; }
    const t = setTimeout(() => {
      api.get("/api/chat/search", { params: { q, exclude: active.session_id } })
        .then((r) => setPast(r.data || [])).catch(() => setPast([]));
    }, 400);
    return () => clearTimeout(t);
  }, [lastGuestMsg, active?.session_id]);

  const snippets = useMemo(() => {
    const base = rawSnippets.length ? rawSnippets : FALLBACK_SNIPPETS;
    const vars = {
      name: active?.diner_name || ctx?.diner?.name || null,
      order: ctx?.orders?.[0]?.code || null,
    };
    return base.map((t) => fillSnippet(t, vars)).filter((x): x is string => !!x);
  }, [rawSnippets, active?.diner_name, ctx?.diner?.name, ctx?.orders]);

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Chats" subtitle="WhatsApp & Instagram conversations — take over from the AI any time" />
      <BackLink />
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
                  className={`rounded-full px-2 py-0.5 text-xs transition ${filter === k ? "bg-zinc-200 font-semibold text-zinc-900" : "bg-zinc-800/70 text-zinc-400 hover:text-zinc-200"}`}>
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
                    <div className="relative mt-0.5 shrink-0">
                      <div
                        className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold"
                        style={{ backgroundColor: "color-mix(in srgb, var(--accent) 20%, transparent)", color: "var(--accent)" }}
                      >
                        {s.diner_name ? s.diner_name.charAt(0).toUpperCase() : "#"}
                      </div>
                      <span className="absolute -bottom-1 -right-1 rounded-full bg-zinc-900 p-0.5 text-zinc-500">
                        {s.channel === "instagram" ? <Instagram size={10} /> : <MessageCircle size={10} />}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`truncate text-sm ${unread ? "font-bold" : "font-medium"}`}>{s.diner_name || s.phone_number || s.session_id}</span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          {s.needs_attention && <AlertCircle size={13} className="text-amber-400" />}
                          {unread && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: "var(--accent)" }} />}
                          <span className="text-xs tabular-nums text-zinc-500">{relTime(s.last_message_at)}</span>
                        </span>
                      </div>
                      <div className={`truncate text-xs ${unread ? "text-zinc-300" : "text-zinc-500"}`}>{s.last_message}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {/* how long they've actually been waiting — the number that decides
                            who you open next, so it outranks every other chip */}
                        {s.needs_attention && s.waiting_min != null && (
                          <span className={`flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-semibold ${s.sla_breached || s.waiting_min >= 15 ? "bg-red-600 text-white" : "bg-amber-500 text-amber-950"}`}>
                            <AlertCircle size={11} aria-hidden="true" /> waiting {s.waiting_min < 1 ? "<1" : s.waiting_min}m{s.sla_breached ? " · over target" : ""}
                          </span>
                        )}
                        {s.draft_stage && (
                          <span className={`flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-medium ${s.draft_stalled_min >= 10 ? "bg-amber-500 text-amber-950" : "bg-sky-600 text-white"}`}>
                            <ShoppingCart size={11} aria-hidden="true" /> {s.draft_stage}
                            {s.draft_stalled_min >= 10 ? ` · stalled ${s.draft_stalled_min}m` : ""}
                          </span>
                        )}
                        {!s.draft_stage && s.last_order && (
                          <span className={`flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-medium ${ORDER_CHIP[s.last_order.status] || "bg-emerald-500/15 text-emerald-300"}`}>
                            <Ticket size={10} /> {s.last_order.code}{s.last_order.total ? ` · ${Number(s.last_order.total).toLocaleString()}` : ""}
                          </span>
                        )}
                        {!s.ai_enabled && (
                          <span className="flex items-center gap-1 rounded-full bg-zinc-700/60 px-1.5 py-0.5 text-xs text-zinc-300">
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
                      // two-step arm instead of confirm() — the sync dialog blocked the main thread (872ms INP)
                      if (!armReset) { setArmReset(true); setTimeout(() => setArmReset(false), 4000); return; }
                      setArmReset(false);
                      await api.delete(`/api/chat/sessions/${encodeURIComponent(active.session_id)}/reset`).catch(() => {});
                      setActive(null); setMessages([]); setCtx(null); loadSessions();
                    }}
                    className={armReset ? "flex items-center gap-1 rounded-lg bg-red-600 p-2 text-xs font-semibold text-white" : "rounded-lg border border-red-500/40 p-2 text-red-400 hover:bg-red-500/10"}
                  ><Trash2 size={14} />{armReset ? "Sure? Wipes everything" : null}</button>
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

              {/* "Where's my order?" is the single most asked question — the answer is
                  pinned here so nobody has to leave the conversation to find it. */}
              {ctx?.friction && (
                <div className="flex items-start gap-2 border-b border-amber-500 bg-amber-50 px-4 py-2 text-xs text-amber-900">
                  <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <span className="flex-1">
                    <b>{ctx.friction.summary}</b>
                    {ctx.friction.repeated?.[0] && <> — “{ctx.friction.repeated[0].text}”</>}
                    {ctx.friction.signals?.length > 0 && <span className="text-amber-800"> · {ctx.friction.signals.join(" · ")}</span>}
                  </span>
                  {active.ai_enabled && (
                    <button onClick={toggleAi} className="shrink-0 cursor-pointer rounded-lg bg-amber-500 px-2 py-0.5 font-semibold text-amber-950 hover:brightness-105">
                      take over
                    </button>
                  )}
                </div>
              )}

              {!active.ai_enabled && (
                <div className="flex flex-wrap items-center gap-1.5 border-b border-zinc-800 px-4 py-1.5 text-xs">
                  <span className="text-zinc-500">Why did it need a human?</span>
                  {HANDOFF_TAGS.map((t) => (
                    <button key={t} onClick={() => tagOutcome(t)}
                      className={`cursor-pointer rounded-full px-2 py-0.5 transition ${active.handoff_reason === t ? "bg-zinc-200 font-semibold text-zinc-900" : "bg-zinc-800/70 text-zinc-400 hover:text-zinc-200"}`}>
                      {t}
                    </button>
                  ))}
                </div>
              )}

              <LiveOrderStrip orders={ctx?.orders} onOpen={(code: string) => nav(
                `/orders?code=${encodeURIComponent(code)}`,
                backTrip(`/chats?session=${encodeURIComponent(active.session_id)}`, `${active.diner_name || "this"} chat`)
              )} />

              <div ref={threadRef} className="flex-1 space-y-2 overflow-y-auto bg-zinc-950/50 p-4">
                {rows.map((row, ri) => {
                  if (row.kind === "day") {
                    return (
                      // NOT sticky: floating this over the thread meant it sat on top of
                      // whatever scrolled under it, covering message text mid-sentence.
                      <div key={row.key} className="flex items-center gap-2 py-2">
                        <div className="h-px flex-1 bg-zinc-800" />
                        <span className="rounded-full bg-zinc-800 px-2.5 py-0.5 text-xs font-medium text-zinc-300">{row.label}</span>
                        <div className="h-px flex-1 bg-zinc-800" />
                      </div>
                    );
                  }
                  if (row.kind === "milestone") {
                    return (
                      <div key={row.key} className="flex items-center gap-2 py-1">
                        <div className="h-px flex-1 bg-zinc-800" />
                        <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-400"><Ticket size={12} /> {row.label}</span>
                        <div className="h-px flex-1 bg-zinc-800" />
                      </div>
                    );
                  }
                  const { m, parts } = row;
                  // sender label shows once per run of same-sender bubbles
                  const prevRow = rows[ri - 1];
                  const showLabel = m.sender !== "guest" && !(prevRow?.kind === "msg" && prevRow.m.sender === m.sender);
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
                        {showLabel && (
                          <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide opacity-70">
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
                            {p.media_url && p.media_type === "document" && !/^📄/m.test(p.message || "") && (
                              <a href={p.media_url} target="_blank" rel="noreferrer"
                                className="mb-1.5 flex w-fit items-center gap-2 rounded-lg border border-zinc-600/50 bg-zinc-900/40 px-2.5 py-1.5 text-xs font-medium hover:bg-zinc-900">
                                <FileText size={14} /> Document — open
                              </a>
                            )}
                            <MessageBody text={p.message} mediaUrl={p.media_url} />
                          </div>
                        ))}
                        <div className="mt-1 flex items-center justify-end gap-1.5">
                          {m.sender === "ai" && (
                            <>
                              {/* icon-only buttons need a real name for screen readers and
                                  voice control — and these feed the Bot quality report */}
                              <button title="Good reply" aria-label={m.rating === 1 ? "Remove good rating" : "Rate this reply good"}
                                aria-pressed={m.rating === 1} onClick={() => rateReply(m, m.rating === 1 ? 0 : 1)}
                                className={`cursor-pointer p-1 transition ${m.rating === 1 ? "text-emerald-400 opacity-100" : "opacity-40 hover:opacity-80"}`}><ThumbsUp size={13} aria-hidden="true" /></button>
                              <button title="Bad reply — flag for review" aria-label={m.rating === -1 ? "Remove bad rating" : "Flag this reply as bad"}
                                aria-pressed={m.rating === -1} onClick={() => rateReply(m, m.rating === -1 ? 0 : -1)}
                                className={`cursor-pointer p-1 transition ${m.rating === -1 ? "text-red-400 opacity-100" : "opacity-40 hover:opacity-80"}`}><ThumbsDown size={13} aria-hidden="true" /></button>
                            </>
                          )}
                          {m.created_at && (
                            <span className="text-xs opacity-40">
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

              {past.length > 0 && (
                <div className="border-t border-zinc-800 px-3 pt-2">
                  <button onClick={() => setShowPast((v) => !v)}
                    className="flex cursor-pointer items-center gap-1 text-xs font-medium text-zinc-400 hover:text-zinc-200">
                    {showPast ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    We answered something like this {past.length}× before
                  </button>
                  {showPast && (
                    <div className="mt-1.5 space-y-1.5">
                      {past.map((p: any, i: number) => (
                        <button key={i} onClick={() => { setText(p.answer); setShowPast(false); }}
                          className="block w-full cursor-pointer rounded-lg border border-zinc-800 px-2.5 py-1.5 text-left transition hover:border-zinc-600">
                          <span className="block truncate text-xs text-zinc-500">asked: “{p.asked}”</span>
                          <span className="mt-0.5 block text-xs text-zinc-200">{p.answer.length > 160 ? p.answer.slice(0, 158) + "…" : p.answer}</span>
                          <span className="mt-0.5 block text-xs text-zinc-600">{p.by === "staff" ? "a person wrote this" : "the bot said this"} · click to reuse</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="border-t border-zinc-800 p-3">
                {undo && (
                  <div className="mb-2 flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300">
                    <span className="flex-1">{undo.label}</span>
                    <button onClick={() => { undo.run(); setUndo(null); }}
                      className="cursor-pointer font-semibold text-[var(--accent)] hover:underline">undo</button>
                  </div>
                )}
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {snippets.map((s) => (
                    <button key={s} onClick={() => setText(s)}
                      className="rounded-full border border-zinc-700/70 px-2.5 py-1 text-xs text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-200">
                      {s.length > 34 ? s.slice(0, 32) + "…" : s}
                    </button>
                  ))}
                  <button onClick={draftReply} disabled={drafting}
                    className="flex items-center gap-1 rounded-full border border-zinc-600 px-2.5 py-1 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-50">
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

// The basket exactly as the bot is holding it: every line, the options the guest chose,
// what each line costs — and above all WHY it has stopped moving. A stalled cart is the
// most actionable thing on this page; a guest sitting on an unanswered size question for
// twelve minutes is a sale you are about to lose, and prose can't tell you that.
// one fact, label above value — the panel is scanned, not read
function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-zinc-500">{k}</div>
      <div className="truncate text-xs font-medium text-zinc-200">{v}</div>
    </div>
  );
}

const LIVE_STATUS: Record<string, string> = {
  pending: "waiting to be accepted", accepted: "accepted", preparing: "in the kitchen",
  ready: "ready", out_for_delivery: "on the way", dispatched: "on the way",
};

function LiveOrderStrip({ orders, onOpen }: { orders: any[] | undefined; onOpen: (code: string) => void }) {
  const live = (orders || []).find((o: any) => LIVE_STATUS[o.status]);
  if (!live) return null;
  const mins = Math.round((Date.now() - new Date(live.created_at).getTime()) / 60000);
  return (
    <button onClick={() => onOpen(live.code)}
      className="flex w-full cursor-pointer items-center gap-2 border-b border-zinc-800 bg-zinc-900/60 px-4 py-2 text-left text-xs transition hover:bg-zinc-900">
      <Ticket size={13} className="shrink-0 text-zinc-400" aria-hidden="true" />
      <span className="font-mono font-bold text-zinc-200">{live.code}</span>
      <span className="text-zinc-300">{LIVE_STATUS[live.status]}</span>
      <span className="text-zinc-500">· {mins}m ago · EGP {money(live.total)}</span>
      {live.order_type && <span className="text-zinc-500">· {String(live.order_type).replace("_", "-")}</span>}
      <span className="ml-auto shrink-0 text-zinc-500">open on the board →</span>
    </button>
  );
}

function DraftCart({ draft, step }: { draft: any; step: number }) {
  const stalled = draft.stalled_min;
  const cold = stalled != null && stalled >= 10;
  const items: any[] = draft.items || [];
  return (
    <div className={`rounded-lg border px-3 py-2.5 text-xs text-zinc-200 ${cold ? "border-amber-500/60 bg-amber-500/10" : "border-sky-500/50 bg-sky-500/10"}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm font-semibold"><ShoppingCart size={14} aria-hidden="true" /> Order in progress</div>
        {stalled != null && (
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${cold ? "bg-amber-500 text-amber-950" : "bg-zinc-800/70 text-zinc-300"}`}>
            {stalled < 1 ? "just now" : `${stalled}m`} {cold ? "stalled" : "ago"}
          </span>
        )}
      </div>

      <div className="mt-2 space-y-1.5">
        {items.map((it, i) => (
          <div key={i}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0"><span className="tabular-nums text-zinc-400">{it.qty}×</span> {it.name}</span>
              <span className="shrink-0 tabular-nums text-zinc-300">{money(it.line_total)}</span>
            </div>
            {it.options?.length > 0 && (
              <div className="pl-5 text-xs text-zinc-400">{it.options.map((o: any) => o.choice).join(" · ")}</div>
            )}
            {it.notes && <div className="pl-5 text-xs text-zinc-400">note: {it.notes}</div>}
            {it.missing_options?.length > 0 && (
              <div className="flex items-center gap-1 pl-5 text-xs font-semibold text-amber-700">
                <AlertCircle size={11} aria-hidden="true" /> needs {it.missing_options.join(", ")}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-2 flex items-baseline justify-between border-t border-zinc-100/10 pt-1.5 font-semibold">
        <span>Subtotal</span>
        <span className="tabular-nums">EGP {money(draft.subtotal)}</span>
      </div>
      <div className="mt-0.5 text-xs text-zinc-400">
        {[draft.order_type ? String(draft.order_type).replace("_", "-") : "type not chosen",
          draft.branch, draft.table_number ? `table ${draft.table_number}` : null,
          draft.address, draft.payment_method].filter(Boolean).join(" · ")}
      </div>

      {/* Safety first, above everything else in the card. Deliberately one-sided: this
          warns, it never reassures. menu ingredients are free text, so a miss proves
          nothing and we never render an "all clear" the kitchen might trust. */}
      {draft.guards?.allergy_flags?.length > 0 && (
        <div className="mt-2 rounded-md border border-red-600 bg-red-50 px-2 py-1.5">
          <div className="flex items-center gap-1.5 text-xs font-bold text-red-900">
            <AlertCircle size={13} aria-hidden="true" /> ALLERGY — check before making
          </div>
          {draft.guards.allergy_flags.map((f: any, i: number) => (
            <div key={i} className="text-xs text-red-900">
              <b>{f.item}</b> may contain <b>{f.allergy}</b> <span className="text-red-700">(matched “{f.matched_on}”)</span>
            </div>
          ))}
          <div className="mt-0.5 text-xs text-red-700">Confirm with the kitchen — ingredient lists are free text and may be incomplete.</div>
        </div>
      )}

      {draft.guards?.stock_flags?.length > 0 && (
        <div className="mt-2 rounded-md border border-amber-500 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
          {draft.guards.stock_flags.map((f: any, i: number) => (
            <div key={i}><b>{f.item}</b> — wants {f.wanted}, {f.left > 0 ? `only ${f.left} left` : "sold out"}. Offer something else before they confirm.</div>
          ))}
        </div>
      )}

      {draft.guards?.duplicate_of && (
        <div className="mt-2 rounded-md border border-amber-500 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
          Same basket as order <b>{draft.guards.duplicate_of.code}</b> {draft.guards.duplicate_of.minutes_ago}m ago — check it's not a double-tap.
        </div>
      )}

      {draft.guards?.closed_now && (
        <div className="mt-2 rounded-md border border-amber-500 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
          Kitchen is closed right now — this can't be made without someone deciding to.
        </div>
      )}

      {draft.guards?.pairing?.length > 0 && (
        <div className="mt-2 text-xs text-zinc-400">
          Goes well with: {draft.guards.pairing.map((p: any) => `${p.name}${p.price ? ` (${money(p.price)})` : ""}`).join(" · ")}
        </div>
      )}

      {draft.blockers?.length > 0 && (
        <div className="mt-2 rounded-md bg-zinc-950/40 px-2 py-1.5">
          <div className="text-xs font-semibold text-zinc-300">Waiting on</div>
          <div className="text-xs text-zinc-400">{draft.blockers.join(" · ")}</div>
        </div>
      )}

      {/* items → options → details → payment → confirm, filled to the current stage */}
      <div className="mt-2 flex items-center gap-1">
        {DRAFT_STEPS.map((label, i) => (
          <div key={label} className="flex-1">
            <div className={`h-1.5 rounded-full ${i < step ? "bg-sky-400" : "bg-zinc-700"}`} />
            <div className={`mt-1 text-center text-xs ${i < step ? "text-sky-300" : "text-zinc-500"}`}>{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
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
        <div className="text-xs text-zinc-500">{tier}{d ? ` · ${d.visit_count} visit${Number(d.visit_count) === 1 ? "" : "s"}` : ""}{d?.total_spend > 0 ? ` · EGP ${Number(d.total_spend).toLocaleString()} lifetime` : ""}</div>
        <div className="mt-1 space-y-0.5 text-xs text-zinc-400">
          <div>{d?.phone_number || s?.session_id}</div>
          {d?.wa_profile_name && d?.name && d.wa_profile_name !== d.name && <div>WhatsApp name: {d.wa_profile_name}</div>}
          {d?.last_seen_at && <div>Last seen: {new Date(d.last_seen_at).toLocaleString()}</div>}
          {d?.preferred_branch && <div>Usual branch: {d.preferred_branch}</div>}
        </div>
      </div>

      {ctx.draft && <DraftCart draft={ctx.draft} step={step} />}

      {/* How this guest orders, in the shape a human can act on: never ask them
          something their own history already answers. */}
      {(ctx.profile?.orders_count > 0 || ctx.order_stats?.usual) && (
        <PanelBlock title="How they order">
          {ctx.order_stats?.usual && <div>Their usual: <b>{ctx.order_stats.usual.name}</b> (×{ctx.order_stats.usual.times})</div>}
          {ctx.profile?.top_items?.length > 1 && (
            <div className="text-zinc-400">Also orders: {ctx.profile.top_items.slice(1).map((t: any) => `${t.name} ×${t.times}`).join(" · ")}</div>
          )}
          <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5">
            {ctx.profile?.favourite_type && <Fact k="Usually" v={String(ctx.profile.favourite_type.value).replace("_", "-")} />}
            {ctx.profile?.favourite_branch && <Fact k="Branch" v={ctx.profile.favourite_branch.value} />}
            {ctx.profile?.usual_payment && <Fact k="Pays by" v={ctx.profile.usual_payment.value} />}
            {ctx.profile?.avg_ticket != null && <Fact k="Avg order" v={`EGP ${money(ctx.profile.avg_ticket)}`} />}
            {ctx.profile?.orders_count > 0 && <Fact k="Orders" v={String(ctx.profile.orders_count)} />}
            {ctx.profile?.cancelled_count > 0 && <Fact k="Cancelled" v={String(ctx.profile.cancelled_count)} />}
            {ctx.profile?.writes_in && <Fact k="Writes in" v={ctx.profile.writes_in} />}
            {ctx.profile?.last_order_at && <Fact k="Last order" v={String(ctx.profile.last_order_at).slice(0, 10)} />}
          </div>
        </PanelBlock>
      )}

      {/* Previous complaints, before you say something that reopens one. */}
      {ctx.feedback && (
        <div className={`rounded-lg border px-3 py-2 text-xs ${ctx.feedback.last?.rating != null && ctx.feedback.last.rating <= 3 ? "border-amber-500/50 bg-amber-500/10 text-zinc-200" : "border-zinc-800 bg-zinc-900/60 text-zinc-300"}`}>
          <div className="font-semibold">
            Left {ctx.feedback.count} review{ctx.feedback.count > 1 ? "s" : ""}
            {ctx.feedback.avg_rating != null ? ` · avg ${ctx.feedback.avg_rating}★` : ""}
          </div>
          {ctx.feedback.last?.comment && <div className="mt-0.5 text-zinc-400">“{ctx.feedback.last.comment}”</div>}
        </div>
      )}

      {ctx.saved_addresses?.length > 0 && (
        <PanelBlock title="Saved addresses">
          {ctx.saved_addresses.map((a: any, i: number) => (
            <button key={i} onClick={() => navigator.clipboard?.writeText(a.text)}
              title="Click to copy"
              className="flex w-full cursor-pointer items-start gap-1 rounded px-1 py-0.5 text-left transition hover:bg-zinc-800/60">
              <MapPin size={12} className="mt-0.5 shrink-0 text-zinc-500" aria-hidden="true" />
              <span>{a.text}{a.last_used ? <span className="text-zinc-500"> · last used {String(a.last_used).slice(0, 10)}</span> : null}</span>
            </button>
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
  // collapsible, remembered per device — the panel gets long for regulars
  const [open, setOpen] = useState(localStorage.getItem(`panel_${title}`) !== "closed");
  const toggle = () => {
    const next = !open;
    setOpen(next);
    localStorage.setItem(`panel_${title}`, next ? "open" : "closed");
  };
  return (
    <div>
      <button onClick={toggle} className="mb-1 flex w-full items-center gap-1 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500 hover:text-zinc-300">
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        {title}
      </button>
      {open && <div className="space-y-0.5 text-xs text-zinc-300">{children}</div>}
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
