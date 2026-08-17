import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Search, Star, MessageCircle, Download, Megaphone, AlertCircle, MapPin,
  Ticket, X, Cake, Store, Clock, Bot, PenLine,
} from "lucide-react";
import { api, session } from "../config/api";
import { Card, PageHeader, Pill, Input, Empty, Btn } from "../components/ui";

// money never reads "478.8" — whole numbers stay whole, fractions get two places
import { money } from "../lib/format";

// relTime is a compact badge value ("today", "6h", "3d"); this is the sentence form,
// because "Last order today ago" is what you get from gluing " ago" onto all of them.
function agoPhrase(ts?: string | null): string {
  const t = relTime(ts);
  return t === "never" ? "never" : t === "today" ? "today" : `${t} ago`;
}

function relTime(ts?: string | null): string {
  if (!ts) return "never";
  const s = (Date.now() - new Date(ts).getTime()) / 1000;
  if (s < 3600) return "today";
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function daysSince(ts?: string | null): number {
  if (!ts) return Infinity;
  return (Date.now() - new Date(ts).getTime()) / 86400000;
}

// lifecycle is computed from behaviour, not typed by hand
// ---------- who a guest actually is ----------
// The old version read visit_count alone, so someone who came twice and spent 8,000 was
// filed identically to someone who came twice and spent 200. Restaurants segment on
// Recency / Frequency / Monetary, and all three are already on the row.
//
// Scores are RELATIVE to this restaurant's own guests, not absolute thresholds: "a lot of
// visits" means something different for a fine-dining room than a burger counter, and a
// hardcoded number would be wrong for one of them.

export type Rfm = { r: number; f: number; m: number; segment: string; tone: string; why: string };

// value at the given quantile of a sorted list
const quantile = (sorted: number[], q: number) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] : 0;

// score 1..3 against the cohort's own distribution
function scoreAgainst(v: number, sorted: number[]): number {
  if (sorted.length < 4) return 2;                       // too few guests to rank meaningfully
  if (v >= quantile(sorted, 0.66)) return 3;
  if (v >= quantile(sorted, 0.33)) return 2;
  return 1;
}

// How often this guest normally comes back, from their own history: first seen → last seen
// spread over their visits. Used instead of a flat "30 days = lapsed", because a weekly
// regular going quiet for 20 days matters and a once-a-quarter guest at 40 days does not.
export function ownRhythmDays(d: any): number | null {
  const visits = Number(d.visit_count) || 0;
  if (visits < 3) return null;                            // no rhythm to speak of yet
  const first = new Date(d.created_at || 0).getTime();
  const last = new Date(d.last_visit_at || d.last_seen_at || 0).getTime();
  const span = (last - first) / 86400000;
  if (!Number.isFinite(span) || span <= 0) return null;
  return Math.max(1, Math.round(span / (visits - 1)));
}

export function buildRfm(all: any[]) {
  const spends = all.map((d) => Number(d.total_spend) || 0).sort((a, b) => a - b);
  const visits = all.map((d) => Number(d.visit_count) || 0).sort((a, b) => a - b);

  return (d: any): Rfm => {
    // Recency may be genuinely UNKNOWN — a guest can have orders while last_seen_at is
    // never set. Treating "unknown" as "ancient" labelled someone who ordered today as
    // "at risk · quiet Infinity days". No signal is not the same as a bad signal.
    const lastAt = d.last_visit_at || d.last_seen_at || null;
    const idle = lastAt ? Math.floor(daysSince(lastAt)) : null;
    const rhythm = lastAt ? ownRhythmDays(d) : null;
    const overdue = rhythm && idle != null ? idle / rhythm : null;

    const f = scoreAgainst(Number(d.visit_count) || 0, visits);
    const m = scoreAgainst(Number(d.total_spend) || 0, spends);
    // recency scored against their OWN rhythm where we know it, else plain days,
    // else neutral — never penalised for a field nobody filled in
    const r = overdue != null ? (overdue <= 1 ? 3 : overdue <= 2 ? 2 : 1)
      : idle == null ? 2
      : idle <= 14 ? 3 : idle <= 45 ? 2 : 1;

    const visitCount = Number(d.visit_count) || 0;
    let segment = "regular", tone = "zinc", why = "";

    if (visitCount === 0) { segment = "never ordered"; tone = "zinc"; why = "has messaged you but never bought"; }
    else if (visitCount === 1 && (idle == null || idle <= 30)) { segment = "just started"; tone = "sky"; why = "first order, still fresh"; }
    else if (idle != null && r === 1 && (f + m) >= 5) { segment = "slipping away"; tone = "red"; why = rhythm ? `usually every ${rhythm}d, quiet ${idle}d` : `quiet ${idle} days`; }
    else if (idle != null && r === 1) { segment = "gone quiet"; tone = "zinc"; why = `no order in ${idle} days`; }
    else if (f === 3 && m === 3) { segment = "best guests"; tone = "amber"; why = "orders often and spends the most"; }
    else if (m === 3) { segment = "spends big"; tone = "violet"; why = "spends well above average"; }
    else if (f === 3) { segment = "orders often"; tone = "emerald"; why = "one of your most frequent"; }
    else { segment = "coming back"; tone = "emerald"; why = "has ordered more than once"; }

    return { r, f, m, segment, tone, why };
  };
}

// Theme-proof: fixed colours don't invert for light mode, so a pale tone on a tint
// disappears on white. Solid background + near-black text reads in both.
export const SEG_CLS: Record<string, string> = {
  amber:   "bg-amber-500 text-amber-950",
  emerald: "bg-emerald-500 text-emerald-950",
  sky:     "bg-sky-500 text-white",
  red:     "bg-red-600 text-white",
  violet:  "bg-violet-500 text-white",
  zinc:    "bg-zinc-700 text-zinc-100",
};

const SEGMENTS = [
  { key: "all", label: "All" },
  { key: "best guests", label: "Best guests" },
  { key: "orders often", label: "Orders often" },
  { key: "spends big", label: "Spends big" },
  { key: "coming back", label: "Coming back" },
  { key: "just started", label: "Just started" },
  { key: "slipping away", label: "Slipping away" },
  { key: "gone quiet", label: "Gone quiet" },
  { key: "never ordered", label: "Never ordered" },
  { key: "vip", label: "VIP" },
];

// one line explaining what each name MEANS, shown on the segment cards
export const SEG_MEANING: Record<string, string> = {
  "best guests": "order often and spend the most",
  "orders often": "among your most frequent",
  "spends big": "spend well above average",
  "coming back": "ordered more than once",
  "just started": "first order, still fresh",
  "slipping away": "were regular, now overdue",
  "gone quiet": "haven't ordered in a long time",
  "never ordered": "messaged you but never bought",
};

function daysUntilMMDD(mmdd?: string | null): number | null {
  if (!mmdd || !/^\d{2}-\d{2}$/.test(mmdd)) return null;
  const [m, d] = mmdd.split("-").map(Number);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(now.getFullYear(), m - 1, d);
  if (next < today) next = new Date(now.getFullYear() + 1, m - 1, d);
  return Math.round((next.getTime() - today.getTime()) / 86400000);
}

export default function Diners() {
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [seg, setSeg] = useState("all");
  const [sort, setSort] = useState<"seen" | "spend" | "visits">("seen");
  const [selected, setSelected] = useState<any | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [broadcast, setBroadcast] = useState(false);
  const [compact, setCompact] = useState(() => localStorage.getItem("diners_compact") === "1");
  const [filters, setFilters] = useState<{ allergy: boolean; bday: boolean; branch: string; tag: string; minSpend: string }>(
    { allergy: false, bday: false, branch: "", tag: "", minSpend: "" });
  const [bulkBusy, setBulkBusy] = useState("");

  // Sequential, and it reports what failed by name — a bulk action that claims success
  // while half of it silently didn't apply is worse than one that refuses.
  async function bulkPatch(build: (d: any) => any, label: string) {
    const chosen = rows.filter((d) => sel.has(String(d.id)));
    if (!chosen.length) return;
    setBulkBusy(label);
    const failed: string[] = [];
    for (const d of chosen) {
      try { await api.patch(`/api/diners/${d.id}`, build(d)); }
      catch { failed.push(d.name || d.phone_number); }
    }
    setBulkBusy("");
    await load();
    setSel(new Set());
    if (failed.length) alert(`${chosen.length - failed.length} updated, ${failed.length} failed:\n${failed.join(", ")}`);
  }
  const nav = useNavigate();

  const load = () => api.get("/api/diners", { params: { q } }).then((r) => setRows(r.data)).catch(() => {});

  // ?item=<dish> — arriving from the Menu's "47 sold" link. Work out who those buyers
  // actually are by walking their order history, so a sales figure turns into a list of
  // people you can talk to. Cleared with one tap, never a filter you get stuck inside.
  const [itemFilter, setItemFilter] = useState<string | null>(null);
  const [itemBuyers, setItemBuyers] = useState<Set<string> | null>(null);
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const want = params.get("item");
    if (!want) return;
    setItemFilter(want);
    api.get("/api/orders", { params: { since_days: 365 } }).then((r) => {
      const phones = new Set<string>();
      for (const o of r.data || []) {
        if (o.status === "cancelled") continue;
        if ((o.items || []).some((i: any) => String(i.name || "").toLowerCase() === want.toLowerCase()))
          if (o.phone_number) phones.add(String(o.phone_number));
      }
      setItemBuyers(phones);
    }).catch(() => setItemBuyers(new Set()));
    params.delete("item");
    setParams(params, { replace: true });
  }, [params]);
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [q]);

  async function open(id: string) {
    const { data } = await api.get(`/api/diners/${id}`);
    setSelected(data);
  }

  async function toggleVip(d: any) {
    await api.patch(`/api/diners/${d.id}`, { is_vip: !d.is_vip }).catch(() => {});
    setRows((xs) => xs.map((x) => (x.id === d.id ? { ...x, is_vip: !d.is_vip } : x)));
    if (selected?.id === d.id) setSelected({ ...selected, is_vip: !d.is_vip });
  }

  // scored against the whole cohort, so the ranking means something for THIS restaurant
  const rfmOf = useMemo(() => buildRfm(rows), [rows]);

  const filtered = useMemo(() => {
    let out = rows.filter((d) => {
      if (itemBuyers && !itemBuyers.has(String(d.phone_number))) return false;
      if (filters.allergy && !(d.allergies?.length)) return false;
      if (filters.bday) {
        const days = daysUntilMMDD(d.preferences?.occasions?.birthday);
        if (days === null || days > 31) return false;
      }
      if (filters.branch && d.preferred_branch !== filters.branch) return false;
      if (filters.tag && !(d.tags || []).includes(filters.tag)) return false;
      if (filters.minSpend && Number(d.total_spend || 0) < Number(filters.minSpend)) return false;
      if (seg === "vip") return d.is_vip;
      if (seg === "all") return true;
      return rfmOf(d).segment === seg;
    });
    out = [...out].sort((a, b) =>
      sort === "spend" ? Number(b.total_spend || 0) - Number(a.total_spend || 0)
      : sort === "visits" ? Number(b.visit_count || 0) - Number(a.visit_count || 0)
      : String(b.last_visit_at || b.last_seen_at || "").localeCompare(String(a.last_visit_at || a.last_seen_at || "")));
    return out;
  }, [rows, seg, sort, itemBuyers, filters]);

  function exportCsv() {
    const head = ["name", "phone", "visits", "total_spend", "last_order", "segment", "vip", "allergies", "tags"];
    const chosen = sel.size ? filtered.filter((d) => sel.has(String(d.id))) : filtered;
    const lines = [head.join(",")].concat(chosen.map((d) => [
      JSON.stringify(d.name || d.wa_profile_name || ""), d.phone_number, d.visit_count, d.total_spend,
      d.last_visit_at || d.last_seen_at || "", rfmOf(d).segment, d.is_vip ? "yes" : "", JSON.stringify((d.allergies || []).join("; ")), JSON.stringify((d.tags || []).join("; ")),
    ].join(",")));
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `diners-${seg}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  return (
    <div>
      {/* a filter you can't see is a filter you get stuck in */}
      {itemFilter && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-300">
          <span>Showing guests who ordered <b className="text-zinc-100">{itemFilter}</b>
            {itemBuyers ? ` · ${filtered.length} of ${rows.length}` : " · loading…"}</span>
          <button onClick={() => { setItemFilter(null); setItemBuyers(null); }}
            className="ml-auto cursor-pointer rounded-lg border border-zinc-700 px-2 py-0.5 text-zinc-300 hover:bg-zinc-800">clear</button>
        </div>
      )}
      <PageHeader
        title="Diners"
        subtitle="Built automatically from every chat and order — the AI captures names, tastes and addresses as guests talk, and reads them back to personalize"
        actions={
          <div className="flex items-center gap-2">
            <button onClick={exportCsv} title="Export the selected guests, or the whole view when none are selected"
              className="rounded-xl border border-zinc-700 p-2.5 text-zinc-300 hover:bg-zinc-800"><Download size={15} /></button>
            <button onClick={() => { setCompact((v) => { localStorage.setItem("diners_compact", v ? "0" : "1"); return !v; }); }}
              title="Row height"
              className="hidden cursor-pointer rounded-xl border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 md:block">
              {compact ? "Comfortable" : "Compact"}
            </button>
            <button onClick={() => setBroadcast(true)}
              title="Plan a message to this segment"
              className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-zinc-700 px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-800">
              <Megaphone size={13} /> Broadcast
            </button>
            <div className="relative">
              <Search size={15} className="absolute left-3 top-2.5 text-zinc-500" />
              <Input placeholder="Search name, phone, tag…" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
        }
      />

      {/* Only All / VIP live here — every other segment is a card below, which shows the
          count and the share of spend too. Two rows of the same filter was just clutter. */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {[{ key: "all", label: "All guests" }, { key: "vip", label: "VIP only" }].map((x) => (
          <button key={x.key} onClick={() => setSeg(x.key)}
            className={`cursor-pointer rounded-full px-3 py-1 text-xs transition ${seg === x.key ? "bg-zinc-200 font-semibold text-zinc-900" : "bg-zinc-800/70 text-zinc-400 hover:text-zinc-200"}`}>
            {x.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1 text-xs text-zinc-500">
          sort
          <select value={sort} onChange={(e) => setSort(e.target.value as any)}
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-200">
            <option value="seen">last seen</option>
            <option value="spend">spend</option>
            <option value="visits">visits</option>
          </select>
        </div>
      </div>

      {broadcast && (
        <BroadcastModal
          audience={sel.size ? filtered.filter((d) => sel.has(String(d.id))) : filtered}
          segLabel={sel.size ? `${sel.size} selected` : (SEGMENTS.find((x) => x.key === seg)?.label || seg)}
          onClose={() => setBroadcast(false)}
        />
      )}

      {sel.size > 0 && (
        <BulkBar
          count={sel.size}
          busy={bulkBusy}
          onClear={() => setSel(new Set())}
          onVip={(on: boolean) => bulkPatch(() => ({ is_vip: on }), on ? "Marking VIP" : "Removing VIP")}
          onTag={(t: string) => bulkPatch((d: any) => ({ tags: [...new Set([...(d.tags || []), t])] }), "Tagging")}
          onBroadcast={() => setBroadcast(true)}
          onExport={exportCsv}
        />
      )}

      <SegmentBar rows={rows} rfmOf={rfmOf} seg={seg} setSeg={setSeg} />
      <GuestTrend rows={rows} />
      <FilterRow rows={rows} filters={filters} setFilters={setFilters} />
      <BirthdayStrip rows={rows} onOpen={(d: any) => open(d.id)} />

      <div>
        <div>
          {filtered.length === 0 ? (
            <Card className="p-8 text-center">
              <p className="text-sm text-zinc-400">
                {rows.length === 0 ? "No guests yet — they appear here the moment someone messages the bot."
                  : "No guests match this view."}
              </p>
              {rows.length > 0 && (seg !== "all" || q || itemFilter) && (
                <button onClick={() => { setSeg("all"); setQ(""); setItemFilter(null); setItemBuyers(null); }}
                  className="mt-2 cursor-pointer text-xs text-[var(--accent)] hover:underline">
                  Clear filters and show all {rows.length}
                </button>
              )}
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <div className="hidden max-h-[70vh] overflow-auto md:block">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 z-10 bg-zinc-950 text-zinc-500">
                    <tr className="border-b border-zinc-800">
                      <th className="w-8 py-2 pl-3"></th>
                      <th className="py-2 pr-2 text-left font-medium">Guest</th>
                      <th className="py-2 pr-2 text-left font-medium">Segment</th>
                      <SortTh label="Visits" k="visits" sort={sort} setSort={setSort} />
                      <SortTh label="Spent" k="spend" sort={sort} setSort={setSort} />
                      <th className="py-2 pr-2 text-right font-medium">Avg</th>
                      <SortTh label="Last order" k="seen" sort={sort} setSort={setSort} />
                      <th className="w-8 py-2 pr-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((d) => {
                      const rf = rfmOf(d);
                      const avg = Number(d.visit_count) > 0 ? Number(d.total_spend || 0) / Number(d.visit_count) : null;
                      const idle = daysSince(d.last_visit_at || d.last_seen_at);
                      const rhythm = ownRhythmDays(d);
                      return (
                        <tr key={d.id}
                          onClick={() => open(d.id)}
                          className={`cursor-pointer border-b border-zinc-900 transition hover:bg-zinc-900/60 ${compact ? "[&>td]:py-1" : ""} ${selected?.id === d.id ? "bg-zinc-900" : ""}`}>
                          <td className="py-2 pl-3" onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" checked={sel.has(String(d.id))} aria-label={`Select ${d.name || d.phone_number}`}
                              onChange={() => setSel((x: Set<string>) => { const n = new Set(x); n.has(String(d.id)) ? n.delete(String(d.id)) : n.add(String(d.id)); return n; })}
                              className="h-4 w-4 cursor-pointer accent-[var(--accent)]" />
                          </td>
                          <td className="w-[38%] py-2 pr-3">
                            <span className="flex items-center gap-1.5">
                              {d.is_vip && <Star size={12} className="shrink-0 fill-fuchsia-500 text-fuchsia-500" />}
                              {d.allergies?.length > 0 && (
                                <span title={`Allergies: ${d.allergies.join(", ")}`}><AlertCircle size={12} className="shrink-0 text-red-500" /></span>
                              )}
                              <span className="truncate text-sm font-medium text-zinc-100">{d.name || d.wa_profile_name || d.phone_number}</span>
                            </span>
                            {(d.name || d.wa_profile_name) && (
                              <span className="block truncate text-zinc-500">{d.phone_number}{d.preferred_branch ? ` · ${d.preferred_branch}` : ""}</span>
                            )}
                          </td>
                          {/* the reason lives in the tooltip: a sentence chopped to
                              "has talked to you but ne…" is worse than no sentence */}
                          <td className="py-2 pr-3" title={rf.why}>
                            <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${SEG_CLS[rf.tone]}`}>{rf.segment}</span>
                          </td>
                          <td className="py-2 pr-2 text-right tabular-nums text-zinc-300">{d.visit_count}</td>
                          {/* spend gets weight — it is the reason this page exists */}
                          <td className="py-2 pr-2 text-right text-sm font-semibold tabular-nums text-zinc-100">{money(d.total_spend)}</td>
                          <td className="py-2 pr-2 text-right tabular-nums text-zinc-400">{avg == null ? "—" : money(Math.round(avg))}</td>
                          <td className="py-2 pr-2 text-right tabular-nums">
                            <span className={rhythm && Number.isFinite(idle) && idle > rhythm * 2 ? "text-red-500" : "text-zinc-400"}>
                              {(d.last_visit_at || d.last_seen_at) ? relTime(d.last_visit_at || d.last_seen_at) : "—"}
                            </span>
                            {rhythm && <span className="block text-zinc-600">usually {rhythm}d</span>}
                          </td>
                          <td className="py-2 pr-3 text-right" onClick={(e) => e.stopPropagation()}>
                            <button title={d.is_vip ? "Remove VIP" : "Make VIP"} onClick={() => toggleVip(d)}
                              aria-label={d.is_vip ? "Remove VIP" : "Make VIP"} className="cursor-pointer p-1">
                              <Star size={14} className={d.is_vip ? "fill-fuchsia-500 text-fuchsia-500" : "text-zinc-600 hover:text-zinc-400"} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Below md a horizontally-scrolling 8-column table is unusable, and this is
                  opened on phones during service — same data, stacked. */}
              <div className="divide-y divide-zinc-900 md:hidden">
                {filtered.map((d) => {
                  const rf = rfmOf(d);
                  return (
                    <button key={d.id} onClick={() => open(d.id)}
                      className="flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left transition hover:bg-zinc-900/60">
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          {d.is_vip && <Star size={12} className="shrink-0 fill-fuchsia-500 text-fuchsia-500" />}
                          {d.allergies?.length > 0 && <AlertCircle size={12} className="shrink-0 text-red-500" />}
                          <span className="truncate text-sm font-medium text-zinc-100">{d.name || d.wa_profile_name || d.phone_number}</span>
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5">
                          <span className={`rounded-full px-1.5 py-0.5 text-xs font-medium ${SEG_CLS[rf.tone]}`}>{rf.segment}</span>
                          <span className="truncate text-xs text-zinc-500">{d.visit_count} visits · {(d.last_visit_at || d.last_seen_at) ? relTime(d.last_visit_at || d.last_seen_at) : "—"}</span>
                        </span>
                      </span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-zinc-100">{money(d.total_spend)}</span>
                    </button>
                  );
                })}
              </div>
            </Card>
          )}
        </div>

        {/* drawer, not a column: the list keeps the full width and the profile slides over
            it, so nothing is squeezed to make room for a box that is usually empty */}
        {selected && (
          <>
            <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setSelected(null)} />
            <aside className="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto border-l border-zinc-800 bg-zinc-950 shadow-2xl">
              <button onClick={() => setSelected(null)} aria-label="Close profile"
                className="absolute right-3 top-3 z-10 cursor-pointer rounded-lg p-1 text-zinc-500 hover:text-zinc-200">
                <X size={18} />
              </button>
              <DinerDetail selected={selected} setSelected={setSelected} toggleVip={toggleVip} nav={nav} />
            </aside>
          </>
        )}
      </div>
    </div>
  );
}

function DinerDetail({ selected, setSelected, toggleVip, nav }: any) {
  const bdays = daysUntilMMDD(selected.preferences?.occasions?.birthday);
  return (
    <div className="min-h-full p-5">
      <div className="mb-1 flex items-center gap-2 text-lg font-semibold">
        {selected.name || selected.wa_profile_name || selected.phone_number}
        {selected.is_vip && <Star size={15} className="fill-fuchsia-500 text-fuchsia-500" />}
      </div>
      {/* only when it adds something — an unnamed guest had their number printed twice */}
      {(selected.name || selected.wa_profile_name) && (
        <div className="mb-3 text-sm text-zinc-500">{selected.phone_number}</div>
      )}

      {/* actions — a CRM you can't act from is a spreadsheet */}
      <div className="mb-4 flex flex-wrap gap-2">
        <button onClick={() => nav(`/chats?session=${encodeURIComponent(selected.phone_number)}`)}
          className="flex items-center gap-1.5 rounded-xl bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-900">
          <MessageCircle size={13} /> Open chat
        </button>
        <button onClick={() => toggleVip(selected)}
          className="flex items-center gap-1.5 rounded-xl border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800">
          <Star size={13} className={selected.is_vip ? "fill-fuchsia-400 text-fuchsia-400" : ""} /> {selected.is_vip ? "VIP" : "Make VIP"}
        </button>
        <button disabled title="Available once WhatsApp templates are approved by Meta"
          className="flex cursor-not-allowed items-center gap-1.5 rounded-xl border border-zinc-800 px-3 py-1.5 text-xs text-zinc-600">
          <Megaphone size={13} /> Send offer
        </button>
      </div>

      {selected.allergies?.length > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-2 text-xs font-semibold text-zinc-100">
          <AlertCircle size={14} className="text-red-400" /> Allergies: {selected.allergies.join(", ")}
        </div>
      )}
      {bdays !== null && bdays <= 30 && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-fuchsia-500/40 bg-fuchsia-500/10 px-3 py-2 text-xs text-zinc-200">
          <Cake size={14} className="text-fuchsia-300" /> Birthday {bdays === 0 ? "TODAY" : `in ${bdays} days`}
        </div>
      )}

      {/* the numbers that matter, at a glance */}
      {Number(selected.visit_count) > 0 || Number(selected.total_spend) > 0 ? (
        <div className="mb-4 grid grid-cols-3 gap-2 text-center">
          <Stat label="visits" value={String(selected.visit_count)} />
          <Stat label="lifetime EGP" value={money(selected.total_spend)} />
          <Stat label="avg ticket" value={selected.stats?.avg_ticket ? money(selected.stats.avg_ticket) : "—"} />
        </div>
      ) : (
        <p className="mb-4 rounded-xl bg-zinc-900/60 px-3 py-2 text-xs text-zinc-500">
          Hasn't ordered yet — they've only messaged.
        </p>
      )}
      <Cadence orders={selected.orders} />

      {/* how they order — so nobody has to guess, and the same picture the Chats panel shows */}
      {(selected.stats?.usual || selected.stats?.favourite_type || selected.stats?.when_they_order) && (
        <div className="mb-4 rounded-xl border border-zinc-800 p-3">
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">How they order</div>
          {selected.stats?.usual && (
            <div className="text-xs text-zinc-200">Their usual: <b>{selected.stats.usual.name}</b> <span className="text-zinc-500">(×{selected.stats.usual.times})</span></div>
          )}
          {selected.stats?.top_items?.length > 1 && (
            <div className="mt-0.5 text-xs text-zinc-500">Also: {selected.stats.top_items.slice(1).map((t: any) => `${t.name} ×${t.times}`).join(" · ")}</div>
          )}
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
            {selected.stats?.favourite_type && <MiniFact k="Usually" v={String(selected.stats.favourite_type.value).replace("_", "-")} />}
            {selected.stats?.usual_payment && <MiniFact k="Pays by" v={selected.stats.usual_payment.value} />}
            {selected.stats?.when_they_order && <MiniFact k="Orders in" v={selected.stats.when_they_order} />}
            {selected.stats?.order_count > 0 && <MiniFact k="Orders" v={String(selected.stats.order_count)} />}
            {selected.stats?.cancelled_count > 0 && <MiniFact k="Cancelled" v={String(selected.stats.cancelled_count)} />}
          </div>
        </div>
      )}

      <div className="mb-4 space-y-1 text-xs text-zinc-400">
        {selected.stats?.last_order_at && <div className="flex items-center gap-1.5"><Clock size={11} /> Last order {agoPhrase(selected.stats.last_order_at)}</div>}
        {selected.stats?.favorite_branch && <div className="flex items-center gap-1.5"><Store size={11} /> Favorite branch: {selected.stats.favorite_branch}</div>}
        {selected.preferences?.addresses?.length > 0 && selected.preferences.addresses.map((a: any, i: number) => (
          <div key={i} className="flex items-start gap-1.5"><MapPin size={11} className="mt-0.5 shrink-0" /> {a.text}</div>
        ))}
      </div>

      {/* what the bot learned on its own, as removable chips */}
      {(selected.preferences?.favorite_items?.length || selected.preferences?.facts?.length || selected.preferences?.ai_notes?.length) ? (
        <div className="mb-1 flex items-center gap-1.5 text-xs text-zinc-500">
          <Bot size={12} /> Learned by the AI from their chats & orders — tap × to make it forget anything wrong
        </div>
      ) : null}
      <MemoryChips selected={selected} setSelected={setSelected} field="favorite_items" title="Favorite dishes" hint="what they keep ordering or said they love" />
      <MemoryChips selected={selected} setSelected={setSelected} field="facts" title="Known about them" hint="things they mentioned in conversation" />
      <MemoryChips selected={selected} setSelected={setSelected} field="ai_notes" title="AI observations" hint="patterns the AI noticed on its own" />
      <TagChips selected={selected} setSelected={setSelected} />

      <ConsentAndSource selected={selected} setSelected={setSelected} />
      <NotesLog selected={selected} setSelected={setSelected} />
      <EditForm selected={selected} setSelected={setSelected} />

      {selected.orders?.length > 0 && (
        <>
          <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-zinc-400">Orders ({selected.orders.length})</h3>
          <div className="space-y-1.5">
            {selected.orders.map((o: any) => (
              <div key={o.id} className="rounded-lg bg-zinc-900 px-3 py-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 font-mono font-semibold text-zinc-200"><Ticket size={11} /> {o.code}</span>
                  <span className={o.status === "cancelled" ? "text-red-400" : "text-zinc-400"}>{o.status}</span>
                </div>
                <div className="mt-0.5 flex items-center justify-between text-zinc-500">
                  <span className="truncate pr-2">{o.items}</span>
                  <span className="shrink-0 tabular-nums text-zinc-300">EGP {money(o.total)}</span>
                </div>
                <div className="text-xs text-zinc-600">{String(o.order_type || "").replace("_", "-")}{o.branch ? ` · ${o.branch}` : ""} · {new Date(o.created_at).toLocaleDateString()}</div>
              </div>
            ))}
          </div>
        </>
      )}

      <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-zinc-400">Reservations</h3>
      {selected.reservations?.length ? (
        <div className="space-y-1.5">
          {selected.reservations.map((r: any) => (
            <div key={r.id} className="flex items-center justify-between rounded-lg bg-zinc-900 px-3 py-2 text-xs">
              <span>{r.date} {String(r.time_slot).slice(0, 5)} · {r.party_size}p</span>
              <Pill value={r.status} />
            </div>
          ))}
        </div>
      ) : (
        <div className="text-xs text-zinc-500">No reservations yet</div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-zinc-900 px-2 py-2">
      <div className="text-base font-bold tabular-nums">{value}</div>
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
    </div>
  );
}

// bot memory rendered as chips — delete a wrong one with a tap
function MemoryChips({ selected, setSelected, field, title, hint }: any) {
  const items: string[] = selected.preferences?.[field] || [];
  if (!items.length) return null;
  async function remove(item: string) {
    const next = items.filter((x) => x !== item);
    const preferences = { ...(selected.preferences || {}), [field]: next };
    await api.patch(`/api/diners/${selected.id}`, { preferences }).catch(() => {});
    setSelected({ ...selected, preferences });
  }
  return (
    <div className="mb-3">
      <div className="mb-1 flex items-baseline gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{title}</span>
        {hint && <span className="text-xs text-zinc-600">{hint}</span>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((it) => (
          <span key={it} className="flex items-center gap-1 rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-200">
            {it}
            <button onClick={() => remove(it)} className="text-zinc-500 hover:text-red-400" title="Make the AI forget this"><X size={10} /></button>
          </span>
        ))}
      </div>
    </div>
  );
}

function TagChips({ selected, setSelected }: any) {
  const [adding, setAdding] = useState("");
  const tags: string[] = selected.tags || [];
  async function save(next: string[]) {
    await api.patch(`/api/diners/${selected.id}`, { tags: next }).catch(() => {});
    setSelected({ ...selected, tags: next });
  }
  return (
    <div className="mb-3">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">Tags</div>
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((t) => (
          <span key={t} className="flex items-center gap-1 rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-200">
            {t}
            <button onClick={() => save(tags.filter((x) => x !== t))} className="text-zinc-500 hover:text-red-400"><X size={10} /></button>
          </span>
        ))}
        <input
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && adding.trim()) { save([...tags, adding.trim()]); setAdding(""); } }}
          placeholder="+ tag"
          className="w-16 rounded-full border border-zinc-800 bg-transparent px-2 py-0.5 text-xs text-zinc-300 outline-none focus:border-zinc-600"
        />
      </div>
    </div>
  );
}

// ONE form, ONE save — lights up only when something changed
function EditForm({ selected, setSelected }: any) {
  const initial = {
    allergies: (selected.allergies || []).join(", "),
    notes: selected.notes || "",
    seating: selected.preferences?.seating || "",
    birthday: selected.preferences?.occasions?.birthday || "",
    anniversary: selected.preferences?.occasions?.anniversary || "",
  };
  const [form, setForm] = useState(initial);
  const [saved, setSaved] = useState(false);
  useEffect(() => { setForm(initial); }, [selected.id]);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  async function saveAll() {
    const allergies = form.allergies.split(",").map((x: string) => x.trim().toLowerCase()).filter(Boolean);
    const preferences = {
      ...(selected.preferences || {}),
      seating: form.seating.trim().toLowerCase() || undefined,
      occasions: {
        ...(selected.preferences?.occasions || {}),
        birthday: form.birthday.trim() || undefined,
        anniversary: form.anniversary.trim() || undefined,
      },
    };
    await api.patch(`/api/diners/${selected.id}`, { allergies, notes: form.notes, preferences }).catch(() => {});
    setSelected({ ...selected, allergies, notes: form.notes, preferences });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  // plain function, not a component — a component defined in-render remounts
  // its input on every keystroke and the field loses focus
  const field = (label: string, k: keyof typeof form, placeholder?: string) => (
    <div className="mb-2">
      <div className="mb-1 text-xs text-zinc-500">{label}</div>
      <Input className="w-full" value={form[k]} placeholder={placeholder} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
    </div>
  );

  return (
    <div className="mt-4 rounded-xl border border-zinc-800 p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Edit (the bot uses these)</h3>
      {field("Allergies (comma-sep)", "allergies")}
      {field("Notes", "notes")}
      {field("Seating preference", "seating", "indoor / outdoor / terrace / quiet / window / bar")}
      <div className="grid grid-cols-2 gap-2">
        {field("Birthday (MM-DD)", "birthday")}
        {field("Anniversary (MM-DD)", "anniversary")}
      </div>
      <button
        onClick={saveAll}
        disabled={!dirty && !saved}
        className={`mt-1 rounded-xl px-4 py-1.5 text-xs font-semibold transition ${
          saved ? "bg-emerald-500/20 text-emerald-300" : dirty ? "bg-zinc-100 text-zinc-900" : "cursor-default border border-zinc-800 text-zinc-600"
        }`}
      >
        {saved ? "Saved" : dirty ? "Save changes" : "No changes"}
      </button>
    </div>
  );
}

// sortable column header — clicking a column is how anyone expects a table to work
function SortTh({ label, k, sort, setSort }: { label: string; k: string; sort: string; setSort: (v: any) => void }) {
  const on = sort === k;
  return (
    <th className="py-2 pr-2 text-right font-medium">
      <button onClick={() => setSort(k)} aria-sort={on ? "descending" : "none"}
        className={`cursor-pointer ${on ? "text-zinc-100" : "hover:text-zinc-300"}`}>
        {label}{on ? " ↓" : ""}
      </button>
    </th>
  );
}

// Where the money actually comes from. A count alone is vanity — "12 regulars" means
// nothing until you know they're 64% of revenue, which is what decides who you protect.
// Each card says what the name MEANS, because a segment nobody understands gets ignored.
function SegmentBar({ rows, rfmOf, seg, setSeg }: any) {
  if (rows.length < 4) return null;
  const total = rows.reduce((s: number, d: any) => s + (Number(d.total_spend) || 0), 0) || 1;
  const groups: Record<string, { n: number; egp: number; tone: string }> = {};
  for (const d of rows) {
    const r = rfmOf(d);
    const g = (groups[r.segment] = groups[r.segment] || { n: 0, egp: 0, tone: r.tone });
    g.n++; g.egp += Number(d.total_spend) || 0;
  }
  const list = Object.entries(groups).sort((a, b) => b[1].egp - a[1].egp);
  const maxEgp = Math.max(...list.map(([, g]) => g.egp), 1);

  return (
    <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {list.map(([name, g]) => {
        const pct = Math.round((g.egp / total) * 100);
        const on = seg === name;
        return (
          <button key={name} onClick={() => setSeg(on ? "all" : name)}
            aria-pressed={on}
            title={on ? "Showing these — click to clear" : `Show only these ${g.n} guests`}
            className={`group cursor-pointer rounded-xl border p-3 text-left transition ${
              on ? "border-zinc-400 bg-zinc-900" : "border-zinc-800 hover:border-zinc-600 hover:bg-zinc-900/50"}`}>
            <span className="flex items-baseline justify-between gap-2">
              <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${SEG_CLS[g.tone]}`}>{name}</span>
              <span className="text-lg font-bold tabular-nums text-zinc-100">{g.n}</span>
            </span>
            <span className="mt-1 block text-xs text-zinc-500">{SEG_MEANING[name] || ""}</span>
            {/* share of spend as a bar, not just a number — the whole point is comparison */}
            <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-zinc-800">
              <span className="block h-full rounded-full bg-zinc-400 transition-all group-hover:bg-zinc-300"
                style={{ width: `${Math.max(2, (g.egp / maxEgp) * 100)}%` }} />
            </span>
            <span className="mt-1 block text-xs text-zinc-500">
              {pct}% of spend · {money(Math.round(g.egp))}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// Birthdays are the one piece of guest data with an expiry date on it — useless the day
// after. Surfaced as a strip rather than buried one profile at a time.
function BirthdayStrip({ rows, onOpen }: { rows: any[]; onOpen: (d: any) => void }) {
  const soon = rows
    .map((d) => ({ d, days: daysUntilMMDD(d.preferences?.occasions?.birthday) }))
    .filter((x) => x.days !== null && (x.days as number) <= 14)
    .sort((a, b) => (a.days as number) - (b.days as number));
  if (!soon.length) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-fuchsia-500/40 bg-fuchsia-500/10 px-3 py-2">
      <Cake size={14} className="shrink-0 text-fuchsia-500" aria-hidden="true" />
      <span className="text-xs font-semibold text-zinc-100">Birthdays coming up</span>
      {soon.slice(0, 8).map(({ d, days }) => (
        <button key={d.id} onClick={() => onOpen(d)}
          className="cursor-pointer rounded-full bg-zinc-900/60 px-2.5 py-1 text-xs text-zinc-200 hover:bg-zinc-800">
          {d.name || d.wa_profile_name || d.phone_number} · {days === 0 ? "today" : `${days}d`}
        </button>
      ))}
      {soon.length > 8 && <span className="text-xs text-zinc-500">+{soon.length - 8} more</span>}
    </div>
  );
}

function MiniFact({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-zinc-500">{k}</div>
      <div className="truncate text-xs font-medium text-zinc-200">{v}</div>
    </div>
  );
}

// Notes as a log, not a single box that each person overwrites.
// "Hates coriander" and "complained about a late delivery in March" are both worth keeping,
// and one text field means the second person to type erases the first. Stored as an array
// on preferences, so no migration — the free-text `notes` field stays as it is for the bot.
function NotesLog({ selected, setSelected }: any) {
  const log: any[] = Array.isArray(selected.preferences?.notes_log) ? selected.preferences.notes_log : [];
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const who = session().name || "staff";

  async function add() {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    const entry = { text: body, by: who, at: new Date().toISOString() };
    const preferences = { ...(selected.preferences || {}), notes_log: [entry, ...log].slice(0, 100) };
    try {
      await api.patch(`/api/diners/${selected.id}`, { preferences });
      setSelected({ ...selected, preferences });
      setText("");
    } catch (e: any) {
      alert(e?.response?.data?.error || "Couldn't save that note");
    } finally { setBusy(false); }
  }

  async function remove(at: string) {
    const preferences = { ...(selected.preferences || {}), notes_log: log.filter((n) => n.at !== at) };
    await api.patch(`/api/diners/${selected.id}`, { preferences }).catch(() => {});
    setSelected({ ...selected, preferences });
  }

  return (
    <div className="mt-4 border-t border-zinc-800 pt-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Staff notes</div>
      <div className="flex gap-2">
        <Input className="flex-1" placeholder="What should the team know?" value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
        <Btn className="px-3 py-1.5 text-xs" onClick={add} disabled={busy || !text.trim()}>Add</Btn>
      </div>
      {log.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {log.slice(0, 8).map((n) => (
            <div key={n.at} className="group rounded-lg bg-zinc-900/60 px-2.5 py-1.5">
              <div className="text-xs text-zinc-200">{n.text}</div>
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                {n.by} · {agoPhrase(n.at)}
                <button onClick={() => remove(n.at)} aria-label="Delete note"
                  className="ml-auto cursor-pointer opacity-0 transition group-hover:opacity-100 hover:text-red-500">remove</button>
              </div>
            </div>
          ))}
          {log.length > 8 && <div className="text-xs text-zinc-600">+{log.length - 8} older</div>}
        </div>
      )}
    </div>
  );
}

// ---------- broadcast ----------
// Built, but deliberately CANNOT SEND yet. Delivery needs approved Meta templates and a
// Flows endpoint, and neither exists — so the button that would spend money and reach real
// guests stays disabled rather than shipping a "send" that silently does nothing.
//
// What it does do is the part that gets skipped and then regretted: show exactly who is in
// the audience, what it will cost, and who is excluded and why. Meta bills per conversation
// on marketing sends, so an accidental blast to 900 guests is real money and real goodwill.
const META_PER_MSG_USD = 0.0407;   // Egypt marketing conversation, Oct-2026 card. Verify before sending.

function BroadcastModal({ audience, segLabel, onClose }: { audience: any[]; segLabel: string; onClose: () => void }) {
  const [text, setText] = useState("");

  // Two independent reasons a guest can't be messaged, counted separately so the number
  // that would be billed is never confused with the number you selected.
  const withNumber = audience.filter((d) => String(d.phone_number || "").startsWith("+"));
  const reachable = withNumber.filter(hasConsent);
  const unreachable = audience.length - withNumber.length;
  const noConsent = withNumber.length - reachable.length;
  const cost = reachable.length * META_PER_MSG_USD;
  const preview = text.replace(/\{name\}/g, reachable[0]?.name || "Ahmed");

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Broadcast"
        className="w-full max-w-2xl rounded-2xl border border-zinc-800 bg-zinc-950" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-zinc-800 p-4">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Broadcast to {segLabel}</h2>
            <p className="text-xs text-zinc-500">Plan it now — sending switches on with your Meta templates.</p>
          </div>
          <button onClick={onClose} aria-label="Close"><X size={16} className="text-zinc-500 hover:text-zinc-200" /></button>
        </div>

        <div className="space-y-4 p-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-zinc-800 p-3">
              <div className="text-2xl font-bold tabular-nums text-zinc-100">{reachable.length}</div>
              <div className="text-xs text-zinc-500">will receive it</div>
            </div>
            <div className="rounded-xl border border-zinc-800 p-3">
              <div className="text-2xl font-bold tabular-nums text-zinc-100">${cost.toFixed(2)}</div>
              <div className="text-xs text-zinc-500">estimated Meta cost</div>
            </div>
            <div className="rounded-xl border border-zinc-800 p-3">
              <div className={`text-2xl font-bold tabular-nums ${(unreachable + noConsent) ? "text-amber-600" : "text-zinc-100"}`}>{unreachable + noConsent}</div>
              <div className="text-xs text-zinc-500">
                excluded{noConsent ? ` · ${noConsent} no consent` : ""}{unreachable ? ` · ${unreachable} no number` : ""}
              </div>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Message</label>
            <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)}
              placeholder="Hi {name}, we've missed you — 15% off your next order this week."
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-amber-500" />
            <p className="mt-1 text-xs text-zinc-500">{"{name}"} is replaced per guest.</p>
          </div>

          {text.trim() && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">They'll see</div>
              <div className="text-sm text-zinc-200">{preview}</div>
            </div>
          )}

          <div className="rounded-xl border border-amber-500 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <b>Not connected yet.</b> Marketing messages need a template approved by Meta and a send route in the
            bot service. Until both exist this screen plans the send and prices it, but cannot deliver — so nothing
            here can reach a guest or bill you by accident.
            {noConsent > 0 && <> <b>{noConsent}</b> of these have not agreed to offers and are excluded; mark consent on a guest's profile.</>}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-zinc-800 p-4">
          <button onClick={onClose} className="cursor-pointer rounded-xl border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800">Close</button>
          <button disabled title="Needs approved Meta templates"
            className="cursor-not-allowed rounded-xl border border-zinc-800 px-4 py-2 text-xs text-zinc-600">
            Send to {reachable.length}
          </button>
        </div>
      </div>
    </div>
  );
}

// Selection without an action bar is a checkbox that does nothing. Tag, VIP, message and
// export are the four things anyone actually wants to do to a group of guests at once.
function BulkBar({ count, busy, onClear, onVip, onTag, onBroadcast, onExport }: any) {
  const [tag, setTag] = useState("");
  return (
    <Card className="mb-4 flex flex-wrap items-center gap-2 border-zinc-600 p-3">
      <span className="text-sm font-semibold text-zinc-100">{count} selected</span>
      <span className="mx-1 h-4 w-px bg-zinc-700" />
      <form onSubmit={(e) => { e.preventDefault(); if (tag.trim()) { onTag(tag.trim().toLowerCase()); setTag(""); } }}
        className="flex items-center gap-1">
        <Input className="w-36 text-xs" placeholder="add a tag…" value={tag} onChange={(e) => setTag(e.target.value)} />
        <button type="submit" disabled={!tag.trim()}
          className="cursor-pointer rounded-lg border border-zinc-700 px-2 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800 disabled:opacity-40">tag</button>
      </form>
      <button onClick={() => onVip(true)} className="cursor-pointer rounded-lg border border-zinc-700 px-2 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800">Make VIP</button>
      <button onClick={() => onVip(false)} className="cursor-pointer rounded-lg border border-zinc-700 px-2 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800">Remove VIP</button>
      <button onClick={onBroadcast} className="cursor-pointer rounded-lg border border-zinc-700 px-2 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800">Message these…</button>
      <button onClick={onExport} className="cursor-pointer rounded-lg border border-zinc-700 px-2 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800">Export</button>
      {busy && <span className="text-xs text-zinc-400">{busy}…</span>}
      <button onClick={onClear} className="ml-auto cursor-pointer text-xs text-zinc-500 hover:text-zinc-300">clear</button>
    </Card>
  );
}

// ---------- consent & source ----------
// Marketing consent is the thing that decides whether a broadcast is legal, and it is far
// cheaper to start recording it now than to reconstruct it later from memory. Stored on
// preferences (already an accepted write) so no migration is needed — worth promoting to a
// real column if this ever needs querying at scale.
export function hasConsent(d: any): boolean {
  return d?.preferences?.marketing_consent?.granted === true;
}

function ConsentAndSource({ selected, setSelected }: any) {
  const c = selected.preferences?.marketing_consent || null;
  // Derived on the server from how their orders actually arrived — a dropdown here only
  // ever collected a staff member's guess. Campaign-level attribution waits on UTMs.
  const src = selected.stats?.source || null;
  const [busy, setBusy] = useState(false);

  async function save(patch: any) {
    setBusy(true);
    const preferences = { ...(selected.preferences || {}), ...patch };
    try {
      await api.patch(`/api/diners/${selected.id}`, { preferences });
      setSelected({ ...selected, preferences });
    } catch (e: any) {
      alert(e?.response?.data?.error || "Couldn't save");
    } finally { setBusy(false); }
  }

  return (
    <div className="mt-4 border-t border-zinc-800 pt-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Marketing & source</div>
      <div className="flex flex-wrap items-center gap-2">
        <button disabled={busy}
          onClick={() => save({ marketing_consent: hasConsent(selected) ? { granted: false, at: new Date().toISOString(), by: session().name || "staff" } : { granted: true, at: new Date().toISOString(), by: session().name || "staff" } })}
          className={`cursor-pointer rounded-full px-3 py-1 text-xs font-medium transition ${hasConsent(selected) ? "bg-emerald-500 text-emerald-950" : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"}`}>
          {hasConsent(selected) ? "✓ Agreed to offers" : "No marketing consent"}
        </button>
        {src && (
          <span className="rounded-full bg-zinc-800 px-2.5 py-1 text-xs text-zinc-300" title={src.detail}>
            via {src.channel}
          </span>
        )}
        {selected.stats?.favourite_type && (
          <span className="rounded-full bg-zinc-800 px-2.5 py-1 text-xs text-zinc-300">
            mostly {String(selected.stats.favourite_type.value).replace("_", "-")}
          </span>
        )}
      </div>
      {c?.at && (
        <p className="mt-1 text-xs text-zinc-500">
          {c.granted ? "Given" : "Withdrawn"} {agoPhrase(c.at)}{c.by ? ` by ${c.by}` : ""}
        </p>
      )}
      {!c && <p className="mt-1 text-xs text-zinc-500">Needed before any campaign.</p>}
    </div>
  );
}


// Segment answers "who are they"; these answer "which of them, specifically" — the
// questions staff actually ask out loud: VIPs in New Cairo, anyone with allergies,
// whose birthday is this month.
function FilterRow({ rows, filters, setFilters }: any) {
  const branches = [...new Set(rows.map((d: any) => d.preferred_branch).filter(Boolean))] as string[];
  const tags = [...new Set(rows.flatMap((d: any) => d.tags || []))] as string[];
  const on = filters.allergy || filters.bday || filters.branch || filters.tag || filters.minSpend;
  const chip = (active: boolean) =>
    `cursor-pointer rounded-full px-2.5 py-1 text-xs transition ${active ? "bg-zinc-200 font-semibold text-zinc-900" : "bg-zinc-800/70 text-zinc-400 hover:text-zinc-200"}`;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <button className={chip(filters.allergy)} onClick={() => setFilters((f: any) => ({ ...f, allergy: !f.allergy }))}>has allergies</button>
      <button className={chip(filters.bday)} onClick={() => setFilters((f: any) => ({ ...f, bday: !f.bday }))}>birthday this month</button>
      {branches.length > 0 && (
        <select value={filters.branch} onChange={(e) => setFilters((f: any) => ({ ...f, branch: e.target.value }))}
          aria-label="Branch" className="cursor-pointer rounded-full border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-300">
          <option value="">any branch</option>
          {branches.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      )}
      {tags.length > 0 && (
        <select value={filters.tag} onChange={(e) => setFilters((f: any) => ({ ...f, tag: e.target.value }))}
          aria-label="Tag" className="cursor-pointer rounded-full border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-300">
          <option value="">any tag</option>
          {tags.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      )}
      <span className="flex items-center gap-1 text-xs text-zinc-500">
        spent over
        <input type="number" value={filters.minSpend} placeholder="0" aria-label="Minimum spend"
          onChange={(e) => setFilters((f: any) => ({ ...f, minSpend: e.target.value }))}
          className="w-20 rounded-full border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200" />
      </span>
      {on && (
        <button onClick={() => setFilters({ allergy: false, bday: false, branch: "", tag: "", minSpend: "" })}
          className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-300">clear filters</button>
      )}
    </div>
  );
}

// Is the guest base growing? The page had no time dimension at all, so you could read it
// every day and never know whether you were gaining or bleeding guests.
//
// Two honesty problems this had to solve. Empty weeks were drawn as a 2px bar, which reads
// as a baseline rule — as though something happened. And when nearly everyone arrived in
// one week (a data import, which is exactly what Luci'z looks like), a bar chart is a lie:
// eleven flat bars and one wall tells you nothing except that a chart was drawn.
function GuestTrend({ rows }: { rows: any[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const weeks = useMemo(() => {
    const out: { label: string; n: number; from: number; to: number }[] = [];
    for (let w = 11; w >= 0; w--) {
      const to = Date.now() - w * 7 * 86400000;
      const from = to - 7 * 86400000;
      const n = rows.filter((d) => {
        const t = new Date(d.created_at || 0).getTime();
        return t > from && t <= to;
      }).length;
      out.push({ label: new Date(to).toLocaleDateString(undefined, { month: "short", day: "numeric" }), n, from, to });
    }
    return out;
  }, [rows]);

  const total = weeks.reduce((s, w) => s + w.n, 0);
  if (total < 3) return null;

  const top = Math.max(...weeks.map((w) => w.n), 1);
  const busiest = weeks.reduce((a, c) => (c.n > a.n ? c : a), weeks[0]);
  // one week holding almost everything means there is no trend to read
  const lopsided = busiest.n / total > 0.7;
  const recent = weeks.slice(-4).reduce((s, w) => s + w.n, 0);
  const prior = weeks.slice(-8, -4).reduce((s, w) => s + w.n, 0);
  const delta = prior > 0 ? Math.round(((recent - prior) / prior) * 100) : null;
  const shown = hover != null ? weeks[hover] : null;

  return (
    <Card className="mb-4 p-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-sm font-semibold text-zinc-200">New guests</span>
        <span className="text-2xl font-bold tabular-nums text-zinc-100">{shown ? shown.n : total}</span>
        <span className="text-xs text-zinc-500">{shown ? `in the week to ${shown.label}` : "in the last 12 weeks"}</span>
        {!shown && delta !== null && !lopsided && (
          <span className={`text-xs font-medium ${delta >= 0 ? "text-emerald-600" : "text-red-600"}`}>
            {delta >= 0 ? "▲" : "▼"} {Math.abs(delta)}% vs the four weeks before
          </span>
        )}
      </div>

      {lopsided ? (
        <p className="text-xs text-zinc-500">
          {busiest.n} of these {total} arrived in the single week to <b className="text-zinc-300">{busiest.label}</b> — that's an
          import or a launch, not a trend. A weekly chart won't say anything useful until there are a few normal weeks to compare.
        </p>
      ) : (
        <>
          <div className="flex h-20 items-end gap-1" onMouseLeave={() => setHover(null)}>
            {weeks.map((w, i) => (
              <div key={i} onMouseEnter={() => setHover(i)}
                title={`${w.n} new in the week to ${w.label}`}
                className="flex h-full flex-1 cursor-default items-end">
                {/* a zero week draws NOTHING — a 2px stub reads as activity that didn't happen */}
                {w.n > 0 ? (
                  <div className={`w-full rounded-t transition-colors ${hover === i ? "bg-zinc-200" : "bg-zinc-400"}`}
                    style={{ height: `${Math.max(6, (w.n / top) * 80)}px` }} />
                ) : (
                  <div className="w-full border-b border-dashed border-zinc-700" />
                )}
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex justify-between text-xs text-zinc-500">
            <span>{weeks[0].label}</span>
            <span className="text-zinc-600">peak {busiest.n} · week to {busiest.label}</span>
            <span>{weeks[weeks.length - 1].label}</span>
          </div>
        </>
      )}
    </Card>
  );
}

// Their rhythm, drawn. "Usually every 6 days" is a summary; this shows whether they were
// weekly and stopped, or have always been sporadic — two very different conversations.
// Built from the orders the profile already loads, so it costs nothing extra.
function Cadence({ orders }: { orders?: any[] }) {
  const months = useMemo(() => {
    const out: { label: string; n: number }[] = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const n = (orders || []).filter((o) =>
        o.status !== "cancelled" && String(o.created_at || "").slice(0, 7) === key).length;
      out.push({ label: d.toLocaleDateString(undefined, { month: "short" }), n });
    }
    return out;
  }, [orders]);
  const total = months.reduce((s, m) => s + m.n, 0);
  if (total < 2) return null;
  const top = Math.max(...months.map((m) => m.n), 1);
  return (
    <div className="mb-4">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Order rhythm</div>
      <div className="flex h-10 items-end gap-1">
        {months.map((m, i) => (
          <div key={i} className="flex-1" title={`${m.label}: ${m.n} order${m.n === 1 ? "" : "s"}`}>
            <div className={`w-full rounded-t ${m.n ? "bg-zinc-400" : "bg-zinc-800"}`}
              style={{ height: `${Math.max(2, (m.n / top) * 40)}px` }} />
          </div>
        ))}
      </div>
      <div className="mt-0.5 flex justify-between text-xs text-zinc-600">
        <span>{months[0].label}</span><span>{months[months.length - 1].label}</span>
      </div>
    </div>
  );
}
