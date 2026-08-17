import { useEffect, useState } from "react";
import { Star, AlertTriangle, Check, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import OrderPeek from "../components/OrderPeek";
import { api } from "../config/api";
import { Card, PageHeader, Btn, Input, Empty } from "../components/ui";

function ago(iso: string) {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function Stars({ n }: { n: number | null }) {
  if (n == null) return <span className="text-xs text-zinc-500">no rating</span>;
  return (
    <span className="inline-flex" title={`${n}/5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={14} className={i <= n ? "fill-current text-amber-400" : "text-zinc-600"} />
      ))}
    </span>
  );
}

const FILTERS: [string, string][] = [["all", "All"], ["bad", "Needs attention"], ["unhandled", "Unhandled"], ["resolved", "Resolved"]];
const STATUS_LABEL: Record<string, string> = { new: "New", handling: "Handling", resolved: "Resolved" };

export default function Reviews() {
  const [data, setData] = useState<any>({ reviews: [], counts: {}, kpis: {} });
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ rating: "5", comments: "", phone_number: "", order_code: "" });

  const load = (f = filter) => api.get(`/api/reviews?filter=${f}`).then((r) => setData(r.data)).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(() => load(), 20000);
    return () => clearInterval(t);
  }, [filter]);

  async function patch(id: string, body: any) {
    setBusy(id);
    try {
      await api.patch(`/api/reviews/${id}`, body);
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.error || "Couldn't update — try again");
    } finally {
      setBusy(null);
    }
  }

  async function addManual(e: React.FormEvent) {
    e.preventDefault();
    await api.post("/api/reviews", { ...form, rating: Number(form.rating) }).catch(() => {});
    setForm({ rating: "5", comments: "", phone_number: "", order_code: "" });
    setAddOpen(false);
    load();
  }

  const k = data.kpis || {};
  const c = data.counts || {};

  return (
    <div>
      <PageHeader
        title="Reviews"
        subtitle="Ratings and complaints — bad ones flagged for handling"
        actions={<Btn onClick={() => setAddOpen((v) => !v)}><Plus size={15} /> Log a review</Btn>}
      />

      {/* KPI row */}
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="p-4">
          <div className="text-xs text-zinc-500">Avg rating · 7 days</div>
          <div className="mt-1 text-2xl font-bold">{k.avg_7d ?? "—"}<span className="text-sm font-normal text-zinc-500">/5</span></div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-zinc-500">Avg rating · 30 days</div>
          <div className="mt-1 text-2xl font-bold">{k.avg_30d ?? "—"}<span className="text-sm font-normal text-zinc-500">/5</span></div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-zinc-500">Unhandled complaints</div>
          <div className={`mt-1 text-2xl font-bold ${c.unhandled ? "text-red-400" : ""}`}>{c.unhandled ?? 0}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-zinc-500">Total reviews</div>
          <div className="mt-1 text-2xl font-bold">{c.all ?? 0}</div>
        </Card>
      </div>

      {addOpen && (
        <Card className="mb-5 p-4">
          <form onSubmit={addManual} className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-zinc-400">Rating
              <select className="mt-1 block rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm" value={form.rating} onChange={(e) => setForm({ ...form, rating: e.target.value })}>
                {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} ★</option>)}
              </select>
            </label>
            <Input placeholder="What they said" className="min-w-[220px] flex-1" value={form.comments} onChange={(e) => setForm({ ...form, comments: e.target.value })} />
            <Input placeholder="Phone (optional)" value={form.phone_number} onChange={(e) => setForm({ ...form, phone_number: e.target.value })} />
            <Input placeholder="Order code (optional)" value={form.order_code} onChange={(e) => setForm({ ...form, order_code: e.target.value })} />
            <Btn type="submit">Save</Btn>
          </form>
        </Card>
      )}

      {/* filter chips */}
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map(([key, lbl]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${filter === key ? "bg-zinc-100 text-zinc-900" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`}
          >
            {lbl}{c[key] != null ? ` (${c[key]})` : ""}
          </button>
        ))}
      </div>

      {!data.reviews?.length ? (
        <Empty text={filter === "all" ? "No reviews yet — they'll appear here as guests rate their orders." : "Nothing here."} />
      ) : (
        <div className="flex flex-col gap-3">
          {data.reviews.map((r: any) => (
            <Card key={r.id} className={`p-4 ${r.bad && r.status !== "resolved" ? "border-l-4 border-l-red-500" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Stars n={r.rating} />
                    {r.bad && <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-bold text-red-400"><AlertTriangle size={11} /> COMPLAINT</span>}
                    <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-semibold text-zinc-400">{STATUS_LABEL[r.status] || "New"}</span>
                  </div>
                  {r.comments && <p className="mt-2 text-sm text-zinc-200">{r.comments}</p>}
                  <div className="mt-1.5 flex flex-wrap gap-x-3 text-[11px] text-zinc-500">
                    {r.order_code && <span>Order <OrderPeek code={r.order_code} className="text-zinc-400 hover:text-zinc-200" /></span>}
                    {r.phone_number && <Link to={`/chats?session=${encodeURIComponent(r.phone_number)}`} className="underline decoration-dotted underline-offset-2 hover:text-zinc-200">{r.phone_number}</Link>}
                    {r.source && <span>via {r.source}</span>}
                    <span>{ago(r.created_at)}</span>
                    {r.assigned_to && <span>· assigned to {r.assigned_to}</span>}
                  </div>
                </div>
              </div>

              {/* handling workflow — only for complaints, or anything not yet resolved */}
              {(r.bad || r.status !== "new") && (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-zinc-800 pt-3">
                  {r.status !== "resolved" ? (
                    <>
                      <Input
                        placeholder="Assign to…"
                        className="h-8 w-36 text-xs"
                        defaultValue={r.assigned_to || ""}
                        onBlur={(e) => e.target.value !== (r.assigned_to || "") && patch(r.id, { assigned_to: e.target.value, status: r.status === "new" ? "handling" : r.status })}
                      />
                      {r.status === "new" && <Btn variant="ghost" disabled={busy === r.id} onClick={() => patch(r.id, { status: "handling" })}>Start handling</Btn>}
                      <ResolveButton id={r.id} busy={busy === r.id} onResolve={(note) => patch(r.id, { status: "resolved", resolution_note: note })} />
                    </>
                  ) : (
                    <div className="flex items-center gap-2 text-xs text-emerald-400">
                      <Check size={14} /> Resolved{r.resolution_note ? <span className="text-zinc-400">— {r.resolution_note}</span> : null}
                    </div>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function ResolveButton({ id, busy, onResolve }: { id: string; busy: boolean; onResolve: (note: string) => void }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  if (!open) return <Btn variant="ghost" disabled={busy} onClick={() => setOpen(true)}><Check size={14} /> Resolve</Btn>;
  return (
    <span className="flex items-center gap-2">
      <Input autoFocus placeholder="How it was resolved" className="h-8 w-52 text-xs" value={note} onChange={(e) => setNote(e.target.value)} />
      <Btn disabled={busy} onClick={() => { onResolve(note); setOpen(false); }}>Save</Btn>
    </span>
  );
}
