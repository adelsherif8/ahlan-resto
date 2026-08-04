import { useEffect, useState } from "react";
import { AlertCircle, Bot, Store, TrendingUp, TrendingDown } from "lucide-react";
import { api } from "../config/api";
import { Card, PageHeader, Pill, Empty } from "../components/ui";

import { money } from "../lib/format";

export default function Overview() {
  const [kpis, setKpis] = useState<any | null>(null);
  const [agent, setAgent] = useState<any | null>(null);
  const [guests, setGuests] = useState<any[]>([]);
  const [rtype, setRtype] = useState<string>("fine");
  const [sampleCount, setSampleCount] = useState(0);

  useEffect(() => {
    api.get("/api/diners").then((r) => setGuests(r.data || [])).catch(() => {});
    api.get("/api/settings").then((r) => setRtype(r.data?.basic_info?.restaurant_type || "fine")).catch(() => {});
    api.get("/api/menu").then((r) => {
      setSampleCount((r.data || []).filter((m: any) =>
        (m.options || []).some((g: any) => g.sample || (g.choices || []).some((c: any) => c.sample))).length);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const load = () => api.get("/api/dashboard/kpis").then((r) => setKpis(r.data)).catch(() => {});
    load();
    api.get("/api/dashboard/agent-stats").then((r) => setAgent(r.data)).catch(() => {});
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  if (!kpis) return <Empty text="Loading…" />;
  const casual = rtype === "casual";
  const O = kpis.orders_today || {};

  // one strip for everything that needs a human, instead of scattered banners
  const needs: { text: string; to?: string }[] = [];
  if (kpis.needs_attention > 0) needs.push({ text: `${kpis.needs_attention} conversation${kpis.needs_attention > 1 ? "s" : ""} need${kpis.needs_attention > 1 ? "" : "s"} a human — check Chats` });
  if (O.late_now > 0) needs.push({ text: `${O.late_now} order${O.late_now > 1 ? "s" : ""} running late on the board` });
  if (sampleCount > 0) needs.push({ text: `${sampleCount} menu item${sampleCount > 1 ? "s" : ""} still ha${sampleCount > 1 ? "ve" : "s"} unverified prices — Menu page` });

  return (
    <div>
      <PageHeader title="Overview" subtitle={casual ? "Today at a glance" : "Tonight at a glance"} />

      {needs.length > 0 && (
        <div className="mb-5 space-y-1.5">
          {needs.map((n, i) => (
            <div key={i} className="flex items-center gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm text-zinc-100">
              <AlertCircle size={15} className="shrink-0 text-amber-400" /> {n.text}
            </div>
          ))}
        </div>
      )}

      {casual ? <CasualBoard O={O} kpis={kpis} /> : <FineBoard kpis={kpis} agent={agent} />}

      <GuestsCard guests={guests} />

      {!casual && <FineBottom kpis={kpis} />}
    </div>
  );
}

// ---------------- casual: orders-first ----------------

function CasualBoard({ O, kpis }: any) {
  const delta = O.revenue_yesterday > 0 ? Math.round(((O.revenue - O.revenue_yesterday) / O.revenue_yesterday) * 100) : null;
  const aiPct = O.count > 0 ? Math.round(((O.ai_count || 0) / O.count) * 100) : null;
  const stats = [
    { label: "Revenue today", value: `EGP ${money(O.revenue || 0)}`, sub: delta !== null ? `${delta >= 0 ? "+" : ""}${delta}% vs yesterday` : null, up: delta !== null ? delta >= 0 : null },
    { label: "Orders today", value: O.count ?? 0, sub: O.cancelled ? `${O.cancelled} cancelled` : null },
    { label: "Open now", value: O.open_now ?? 0, sub: O.late_now ? `${O.late_now} late` : null },
    { label: "Avg prep", value: O.avg_prep != null ? `${O.avg_prep} min` : "—" },
    { label: "AI-taken", value: aiPct != null ? `${aiPct}%` : "—", sub: O.ai_count != null ? `${O.ai_count} of ${O.count}` : null },
    { label: "Avg rating", value: kpis.avg_rating ?? "—" },
  ];
  const maxHour = Math.max(1, ...(O.by_hour || []).map((h: any) => h.count));
  return (
    <>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        {stats.map((s) => (
          <Card key={s.label} className="p-4">
            <div className="text-2xl font-bold tabular-nums">{s.value}</div>
            <div className="mt-1 text-[11px] uppercase tracking-wide text-zinc-500">{s.label}</div>
            {s.sub && (
              <div className={`mt-0.5 flex items-center gap-1 text-[11px] ${s.up === true ? "text-emerald-400" : s.up === false ? "text-red-400" : "text-zinc-500"}`}>
                {s.up === true && <TrendingUp size={11} />}
                {s.up === false && <TrendingDown size={11} />}
                {s.sub}
              </div>
            )}
          </Card>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <h2 className="mb-4 text-sm font-semibold text-zinc-300">Orders by hour (today)</h2>
          {(O.by_hour || []).length === 0 ? (
            <Empty text="No orders yet today" />
          ) : (
            <div className="flex h-36 items-end gap-1.5">
              {(O.by_hour || []).map((h: any) => (
                <div key={h.hour} className="flex flex-1 flex-col items-center gap-1">
                  <div className="text-xs text-zinc-400">{h.count}</div>
                  <div className="w-full rounded-t-md" style={{ height: `${(h.count / maxHour) * 100}%`, backgroundColor: "var(--accent)", opacity: 0.85 }} />
                  <div className="text-[10px] text-zinc-500">{String(h.hour).padStart(2, "0")}</div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-zinc-300">Top items today</h2>
          {(O.top_items || []).length === 0 ? (
            <Empty text="—" />
          ) : (
            <div className="space-y-2">
              {(O.top_items || []).map((t: any, i: number) => (
                <div key={t.name} className="flex items-center justify-between text-sm">
                  <span className="truncate pr-2 text-zinc-300">{i + 1}. {t.name}</span>
                  <span className="shrink-0 tabular-nums text-zinc-500">×{t.units}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {(O.by_branch || []).length > 1 && (
        <Card className="mt-4 p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-300"><Store size={14} /> By branch (today)</h2>
          <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            {(O.by_branch || []).map((b: any) => (
              <div key={b.branch} className="flex items-center justify-between rounded-xl bg-zinc-900 px-3 py-2 text-sm">
                <span className="text-zinc-300">{b.branch}</span>
                <span className="tabular-nums text-zinc-400">{b.count} · EGP {money(b.egp)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="mt-4 border-emerald-500/30 p-5">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-emerald-300"><Bot size={15} /> AI order agent — today</h2>
        <p className="text-sm text-zinc-400">
          The AI took <b className="text-zinc-200">{O.ai_count ?? 0}</b> of <b className="text-zinc-200">{O.count ?? 0}</b> orders
          {O.revenue ? <> worth <b className="text-zinc-200">EGP {money(O.revenue)}</b></> : null} — menu questions, options, bills, receipts and status updates included, with staff stepping in only where the strip above says so.
        </p>
      </Card>
    </>
  );
}

// ---------------- fine dining: the original reservation-first board ----------------

function FineBoard({ kpis, agent }: any) {
  const stats = [
    { label: "Covers today", value: kpis.covers_today },
    { label: "Reservations today", value: kpis.reservations_today },
    { label: "Tables seated", value: `${kpis.tables_seated}/${kpis.tables_total}` },
    { label: "Waitlist now", value: kpis.waitlist_now },
    { label: "Open orders", value: kpis.open_orders },
    { label: "Pending deposits", value: kpis.pending_deposits },
    { label: "No-show rate", value: `${kpis.no_show_rate_pct}%` },
    { label: "Avg rating", value: kpis.avg_rating ?? "—" },
  ];
  return (
    <>
      {agent && (
        <Card className="mb-5 border-emerald-500/30 p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-emerald-300"><Bot size={15} /> Reservation agent — last {agent.days} days</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
            {[
              { label: "AI bookings", value: agent.ai_bookings },
              { label: "AI covers", value: agent.ai_covers },
              { label: "Arrivals handled", value: agent.arrivals_handled },
              { label: "Abandoned leads", value: agent.abandoned_leads },
              { label: "Walk-ins / manual", value: `${agent.walk_ins} / ${agent.manual_bookings}` },
            ].map((s) => (
              <div key={s.label}>
                <div className="text-2xl font-bold tabular-nums">{s.value}</div>
                <div className="mt-0.5 text-[11px] uppercase tracking-wide text-zinc-500">{s.label}</div>
              </div>
            ))}
          </div>
        </Card>
      )}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="p-5">
            <div className="text-3xl font-bold tabular-nums">{s.value}</div>
            <div className="mt-1 text-xs uppercase tracking-wide text-zinc-500">{s.label}</div>
          </Card>
        ))}
      </div>
    </>
  );
}

function FineBottom({ kpis }: any) {
  const maxCovers = Math.max(1, ...kpis.by_slot.map((s: any) => s.covers));
  return (
    <div className="mt-6 grid gap-4 lg:grid-cols-2">
      <Card className="p-5">
        <h2 className="mb-4 text-sm font-semibold text-zinc-300">Covers by slot (today)</h2>
        {kpis.by_slot.length === 0 ? (
          <Empty text="No reservations today yet" />
        ) : (
          <div className="flex h-40 items-end gap-2">
            {kpis.by_slot.map((s: any) => (
              <div key={s.slot} className="flex flex-1 flex-col items-center gap-1">
                <div className="text-xs text-zinc-400">{s.covers}</div>
                <div className="w-full rounded-t-lg bg-amber-500/80" style={{ height: `${(s.covers / maxCovers) * 100}%` }} />
                <div className="text-[10px] text-zinc-500">{s.slot}</div>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card className="p-5">
        <h2 className="mb-4 text-sm font-semibold text-zinc-300">Next up</h2>
        {kpis.upcoming.length === 0 ? (
          <Empty text="Nothing upcoming" />
        ) : (
          <div className="space-y-2">
            {kpis.upcoming.map((r: any) => (
              <div key={r.id} className="flex items-center justify-between rounded-xl bg-zinc-900 px-3 py-2.5">
                <div>
                  <div className="text-sm font-medium">{r.diner_name || r.diner_phone} · {r.party_size}p</div>
                  <div className="text-xs text-zinc-500">{r.date} {String(r.time_slot).slice(0, 5)}{r.occasion ? ` · ${r.occasion}` : ""}</div>
                </div>
                <Pill value={r.status} />
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function GuestsCard({ guests }: { guests: any[] }) {
  if (!guests.length) return null;
  const week = Date.now() - 7 * 86400000;
  const newThisWeek = guests.filter((g) => new Date(g.created_at).getTime() > week).length;
  const visited = guests.filter((g) => Number(g.visit_count) > 0);
  const repeat = visited.length ? Math.round((visited.filter((g) => Number(g.visit_count) >= 2).length / visited.length) * 100) : 0;
  const top = [...guests].sort((a, b) => Number(b.total_spend || 0) - Number(a.total_spend || 0)).slice(0, 5).filter((g) => Number(g.total_spend) > 0);
  return (
    <Card className="mt-6 p-5">
      <h2 className="mb-3 text-sm font-semibold text-zinc-300">Guests</h2>
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <div className="text-3xl font-bold tabular-nums">{newThisWeek}</div>
          <div className="mt-1 text-xs uppercase tracking-wide text-zinc-500">New this week</div>
        </div>
        <div>
          <div className="text-3xl font-bold tabular-nums">{repeat}%</div>
          <div className="mt-1 text-xs uppercase tracking-wide text-zinc-500">Repeat rate</div>
        </div>
        <div>
          <div className="mb-1 text-xs uppercase tracking-wide text-zinc-500">Top spenders</div>
          {top.length === 0 ? <div className="text-xs text-zinc-600">—</div> : top.map((g) => (
            <div key={g.id} className="flex justify-between text-xs">
              <span className="truncate pr-2 text-zinc-300">{g.name || g.wa_profile_name || g.phone_number}</span>
              <span className="tabular-nums text-zinc-400">EGP {Number(g.total_spend).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
