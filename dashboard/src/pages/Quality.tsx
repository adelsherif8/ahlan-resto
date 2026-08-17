import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ThumbsDown, HelpCircle, HandMetal, Activity, Check, X, ArrowUpRight } from "lucide-react";
import { api } from "../config/api";
import { Card, PageHeader, Select, Empty, Btn, Input } from "../components/ui";

// The feedback loop for the bot. Staff have been rating AI replies 👍/👎 inside Chats
// and filing questions the bot couldn't answer — until now nothing read any of it back.
// Everything here answers one question: what did the bot get wrong this week, and what
// do I do about it? Every card ends in an action — open the chat, or write the answer.

export default function Quality() {
  const [days, setDays] = useState(7);
  const [d, setD] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    api.get(`/api/quality?days=${days}`).then((r) => setD(r.data)).catch(() => setD(null)).finally(() => setLoading(false));
  }
  useEffect(load, [days]);

  if (loading && !d) return <Empty text="Loading…" />;
  if (!d) return <Empty text="Couldn't load bot quality — try again." />;

  const R = d.ratings || {};
  const H = d.handoffs || {};
  const U = d.unanswered || {};
  const E = d.engine;

  return (
    <div>
      <PageHeader
        title="Bot quality"
        subtitle="What the AI got wrong, and what to do about it"
        actions={
          <Select value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
            <option value="1">Today</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
          </Select>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label={`Flagged replies · ${days}d`} value={String(R.down ?? 0)}
          hint={R.rated ? `of ${R.rated} rated · ${R.up ?? 0} good` : "nobody has rated a reply yet"}
          tone={R.down > 0 ? "text-red-400" : undefined} />
        <Kpi label="Handed to a human" value={String(H.count ?? 0)}
          hint={H.rate_pct != null ? `${H.rate_pct}% of active chats` : "no active chats"}
          tone={H.rate_pct != null && H.rate_pct > 25 ? "text-amber-400" : undefined} />
        <Kpi label="Unanswered questions" value={String(U.count ?? 0)}
          hint={U.recent ? `${U.recent} new in this window` : "none new"} />
        <Kpi label="Engine errors" value={E ? `${E.error_pct}%` : "—"}
          hint={E ? `${E.errors} of ${E.runs} runs · p95 ${E.p95_ms ?? "—"}ms` : "no trace data"}
          tone={E && E.error_pct > 2 ? "text-red-400" : undefined} />
      </div>

      {R.rated === 0 && (
        <Card className="mb-4 p-4">
          <p className="text-xs text-zinc-400">
            No replies rated in this window. In <Link to="/chats" className="text-[var(--accent)] hover:underline">Chats</Link>, hover any AI
            message and hit 👍 or 👎 — thumbs-down replies land here with the guest's question attached, so patterns become obvious.
          </p>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-200">
            <ThumbsDown size={15} className="text-red-400" /> Replies staff flagged
          </div>
          {!(d.bad_replies || []).length ? (
            <Empty text="Nothing flagged — the bot is reading well." />
          ) : (
            <div className="space-y-2.5">
              {d.bad_replies.map((m: any) => (
                <div key={m.id} className="rounded-xl border border-zinc-800 p-3">
                  {m.guest_said && (
                    <div className="mb-1.5 text-[11px] text-zinc-500">
                      Guest asked: <span className="text-zinc-300">"{m.guest_said}"</span>
                    </div>
                  )}
                  <div className="text-xs text-zinc-200">{m.message}</div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="truncate text-[11px] text-zinc-600">
                      {m.diner_name || m.session_id} · {when(m.created_at)}
                    </span>
                    <Link to={`/chats?session=${encodeURIComponent(m.session_id)}&msg=${encodeURIComponent(m.id)}`}
                      className="flex shrink-0 items-center gap-1 text-[11px] text-[var(--accent)] hover:underline">
                      open chat <ArrowUpRight size={11} />
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card className="p-4">
            <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-zinc-200">
              <HelpCircle size={15} className="text-sky-400" /> Questions the bot couldn't answer
            </div>
            <p className="mb-3 text-[11px] text-zinc-500">Answer one and it becomes a free, instant reply forever — no AI call, no guessing.</p>
            {!(U.items || []).length ? (
              <Empty text="No open questions." />
            ) : (
              <div className="space-y-2">
                {U.items.map((f: any) => <FaqRow key={f.id} faq={f} onDone={load} />)}
              </div>
            )}
          </Card>

          <Card className="p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-200">
              <HandMetal size={15} className="text-amber-400" /> Why it handed over
            </div>
            {!(H.reasons || []).length ? (
              <Empty text="No handoffs in this window." />
            ) : (
              <div className="space-y-1.5">
                {H.reasons.map((r: any) => (
                  <div key={r.reason} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate text-zinc-300">{r.reason.replaceAll("_", " ")}</span>
                    <span className="shrink-0 tabular-nums text-zinc-500">{r.count}</span>
                  </div>
                ))}
                {(H.sessions || []).length > 0 && (
                  <div className="mt-2 border-t border-zinc-800 pt-2">
                    {H.sessions.slice(0, 6).map((s: any) => (
                      <Link key={s.session_id} to={`/chats?session=${encodeURIComponent(s.session_id)}`}
                        className="flex items-center justify-between gap-2 py-1 text-[11px] text-zinc-500 hover:text-zinc-300">
                        <span className="truncate">{s.diner_name || s.session_id} — {s.last_message || "…"}</span>
                        <span className="shrink-0">{when(s.last_message_at)}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Card>

          {E && (
            <Card className="p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-200">
                <Activity size={15} className="text-emerald-400" /> Engine health
              </div>
              <div className="space-y-1.5">
                {E.by_flow.map((f: any) => (
                  <div key={f.flow} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate text-zinc-300">{f.flow}</span>
                    <span className="shrink-0 tabular-nums text-zinc-500">
                      {f.runs} runs · <span className={f.error_pct > 2 ? "text-red-400" : ""}>{f.error_pct}% err</span> · p95 {f.p95_ms ?? "—"}ms
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-2 border-t border-zinc-800 pt-2 text-[11px] text-zinc-500">
                AI spend in this window: ${E.cost_usd?.toFixed?.(4) ?? E.cost_usd}
                {E.truncated && " · showing the most recent 5,000 runs"}
              </div>
              {(E.recent_errors || []).length > 0 && (
                <div className="mt-2 space-y-1">
                  {E.recent_errors.map((e: any, i: number) => (
                    <div key={i} className="truncate text-[11px] text-red-400/80">{e.flow}: {e.error}</div>
                  ))}
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

// Answer inline — same endpoint Settings uses, so an approved answer joins the FAQ list
// the bot already serves for free.
function FaqRow({ faq, onDone }: { faq: any; onDone: () => void }) {
  const [answer, setAnswer] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function act(action: "approve" | "dismiss") {
    if (action === "approve" && !answer.trim()) return;
    setBusy(true);
    try {
      await api.post(`/api/settings/suggested-faqs/${faq.id}`, { action, answer: answer.trim() });
      onDone();
    } catch (e: any) {
      alert(e?.response?.data?.error || "Couldn't save that answer");
    } finally { setBusy(false); }
  }

  return (
    <div className="rounded-xl border border-zinc-800 p-3">
      <div className="text-xs text-zinc-200">{faq.question}</div>
      {faq.context && <div className="mt-0.5 truncate text-[11px] text-zinc-600">{faq.context}</div>}
      {!open ? (
        <div className="mt-2 flex items-center gap-2">
          <button onClick={() => setOpen(true)} className="rounded-lg border border-zinc-700 px-2 py-1 text-[11px] text-zinc-200 hover:bg-zinc-800">Answer it</button>
          <button onClick={() => act("dismiss")} disabled={busy}
            className="rounded-lg px-2 py-1 text-[11px] text-zinc-500 hover:text-zinc-300 disabled:opacity-40">
            <X size={11} className="inline" /> dismiss
          </button>
          {faq.session_id && (
            <Link to={`/chats?session=${encodeURIComponent(faq.session_id)}`} className="ml-auto text-[11px] text-zinc-600 hover:text-zinc-400">see the chat</Link>
          )}
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-2">
          <Input autoFocus className="flex-1" placeholder="The answer the bot should give…" value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") act("approve"); if (e.key === "Escape") setOpen(false); }} />
          <Btn onClick={() => act("approve")} disabled={busy || !answer.trim()}><Check size={13} /></Btn>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${tone || "text-zinc-100"}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-zinc-500">{hint}</div>}
    </Card>
  );
}

function when(ts?: string | null) {
  if (!ts) return "";
  const m = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}
