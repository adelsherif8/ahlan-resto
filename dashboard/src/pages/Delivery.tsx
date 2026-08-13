import { useEffect, useMemo, useState } from "react";
import {
  Bike, MapPin, Phone, Copy, Check, Clock, Plus, X, MessageCircle, Store,
  AlertTriangle, BadgeCheck, Banknote,
} from "lucide-react";
import { api, session } from "../config/api";
import { Card, PageHeader, Empty, Btn, Input, ArmButton } from "../components/ui";
import { mins } from "../lib/format";

const DRIVER_BASE = "https://flows-production-e528.up.railway.app/driver";

import { money } from "../lib/format";

const STAGE: Record<string, { label: string; cls: string }> = {
  pending: { label: "in kitchen", cls: "bg-zinc-800 text-zinc-300" },
  accepted: { label: "in kitchen", cls: "bg-zinc-800 text-zinc-300" },
  preparing: { label: "cooking", cls: "bg-orange-500/15 text-orange-300" },
  ready: { label: "awaiting rider", cls: "bg-amber-500/15 text-amber-300" },
  out_for_delivery: { label: "on the road", cls: "bg-sky-500/15 text-sky-300" },
  delivered: { label: "delivered", cls: "bg-emerald-500/15 text-emerald-300" },
  served: { label: "delivered", cls: "bg-emerald-500/15 text-emerald-300" },
};

export default function Delivery() {
  const [orders, setOrders] = useState<any[]>([]);
  const [couriers, setCouriers] = useState<any[]>([]);
  const staffBranch = session().branch || "";
  const [branch, setBranch] = useState<string>(staffBranch || "all");
  const [branches, setBranches] = useState<any[]>([]);
  const [addName, setAddName] = useState("");
  const [addPhone, setAddPhone] = useState("");
  const [addVehicle, setAddVehicle] = useState("");
  const [addPlate, setAddPlate] = useState("");
  const [editCourier, setEditCourier] = useState<any | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [zones, setZones] = useState<any[]>([]);
  const [showStats, setShowStats] = useState(true);

  const load = () => {
    api.get("/api/orders", { params: { branch } }).then((r) => setOrders(r.data || [])).catch(() => {});
    api.get("/api/couriers").then((r) => setCouriers(r.data || [])).catch(() => {});
  };
  useEffect(() => {
    api.get("/api/settings").then((r) => {
      setBranches(r.data?.basic_info?.branches || []);
      setZones(r.data?.basic_info?.delivery?.zones || []);
    }).catch(() => {});
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 7000);
    return () => clearInterval(t);
  }, [branch]);

  const today = new Date().toLocaleDateString("en-CA");
  const rows = useMemo(() =>
    orders
      .filter((o) => o.order_type === "delivery" && String(o.created_at).slice(0, 10) === today && o.status !== "cancelled")
      .sort((a, b) => {
        const rank = (o: any) => (["delivered", "served", "paid"].includes(o.status) ? 1 : 0);
        return rank(a) - rank(b) || String(a.created_at).localeCompare(String(b.created_at));
      }),
    [orders]);
  const activeRows = rows.filter((o) => !["delivered", "served", "paid"].includes(o.status));
  const doneRows = rows.filter((o) => ["delivered", "served", "paid"].includes(o.status));
  const codPending = activeRows.filter((o) => o.payment_method === "cash").reduce((s, o) => s + Number(o.total || 0), 0);
  const doorTimes = doneRows
    .map((o) => (o.delivered_at ? (new Date(o.delivered_at).getTime() - new Date(o.created_at).getTime()) / 60000 : null))
    .filter((x): x is number => x !== null && x > 0 && x < 240);
  const avgDoor = doorTimes.length ? Math.round(doorTimes.reduce((s, x) => s + x, 0) / doorTimes.length) : null;

  // ---- driver-fed analytics (last 30 days of delivered delivery orders) ----
  // COD from the driver page: cod_received/cod_change columns (migration 027), with a
  // notes fallback ("COD: received X, change Y") so it works pre-migration too.
  const codOf = (o: any): { received: number; change: number } | null => {
    if (o.cod_received != null) return { received: Number(o.cod_received) || 0, change: Number(o.cod_change) || 0 };
    const m = String(o.notes || "").match(/COD: received (\d+(?:\.\d+)?), change (\d+(?:\.\d+)?)/);
    return m ? { received: Number(m[1]), change: Number(m[2]) } : null;
  };
  // destination = the configured delivery zone whose name/alias appears in the address
  const destOf = (addr: string): string => {
    const t = String(addr || "").toLowerCase();
    for (const z of zones) {
      const names = [z.area, ...(z.aliases || [])].map((s: string) => String(s || "").toLowerCase()).filter((s: string) => s.length >= 3);
      if (names.some((n: string) => t.includes(n))) return z.area;
    }
    return "Other";
  };
  const stats = useMemo(() => {
    const since = Date.now() - 30 * 86400000;
    const del30 = orders.filter((o) => o.order_type === "delivery" && ["delivered", "served", "paid"].includes(o.status)
      && new Date(o.created_at).getTime() > since);
    const byDest: Record<string, { n: number; mins: number[]; fees: number[] }> = {};
    const byCourier: Record<string, { n: number; mins: number[] }> = {};
    for (const o of del30) {
      const t = o.delivered_at ? (new Date(o.delivered_at).getTime() - new Date(o.created_at).getTime()) / 60000 : null;
      const ok = t !== null && t > 0 && t < 240;
      const d = destOf(o.address);
      (byDest[d] = byDest[d] || { n: 0, mins: [], fees: [] }).n++;
      if (ok) byDest[d].mins.push(t as number);
      if (Number(o.delivery_fee)) byDest[d].fees.push(Number(o.delivery_fee));
      const c = o.courier_name || couriers.find((x) => x.id === o.courier_id)?.name;
      if (c) { (byCourier[c] = byCourier[c] || { n: 0, mins: [] }).n++; if (ok) byCourier[c].mins.push(t as number); }
    }
    const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null);
    const dests = Object.entries(byDest).map(([area, v]) => ({ area, n: v.n, avgMin: avg(v.mins), avgFee: avg(v.fees) }))
      .sort((a, b) => b.n - a.n);
    const courierRows = Object.entries(byCourier).map(([name, v]) => ({ name, n: v.n, avgMin: avg(v.mins) })).sort((a, b) => b.n - a.n);
    // COD reconciliation for TODAY's delivered cash orders
    const cashDone = doneRows.filter((o) => o.payment_method === "cash");
    const expected = cashDone.reduce((s, o) => s + Number(o.total || 0), 0);
    const recorded = cashDone.map(codOf).filter(Boolean) as { received: number; change: number }[];
    const received = recorded.reduce((s, r) => s + r.received, 0);
    const change = recorded.reduce((s, r) => s + r.change, 0);
    return { dests, courierRows, cod: { expected, received, change, net: received - change, recorded: recorded.length, of: cashDone.length } };
  }, [orders, zones, couriers, doneRows]);

  async function assign(o: any, courierId: string) {
    const c = couriers.find((x) => x.id === courierId);
    setOrders((xs) => xs.map((x) => (x.id === o.id ? { ...x, courier_id: courierId || null, courier_name: c?.name || null, courier_phone: c?.phone_number || null } : x)));
    await api.post(`/api/orders/${o.id}/assign`, courierId ? { courier_id: courierId } : {}).catch(load);
  }
  // re-run the smart assigner: free riders first, nearby drops batch together
  async function autoAssign(o: any) {
    const { data } = await api.post(`/api/orders/${o.id}/assign`, {}).catch(() => ({ data: null }));
    if (data) load();
  }

  function driverLink(o: any) { return o.courier_token ? `${DRIVER_BASE}/${o.courier_token}` : null; }

  function copyLink(o: any) {
    const l = driverLink(o);
    if (!l) return;
    navigator.clipboard?.writeText(l).catch(() => {});
    setCopiedId(o.id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  // opens the STAFF member's own WhatsApp with the link prefilled for the courier
  function waSend(o: any) {
    const l = driverLink(o);
    if (!l) return;
    const phone = String(o.courier_phone || "").replace(/[^\d]/g, "");
    const text = encodeURIComponent(`Delivery ${o.code} — everything you need is here:\n${l}`);
    window.open(phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`, "_blank");
  }

  async function addCourier() {
    if (!addName.trim()) return;
    await api.post("/api/couriers", { name: addName.trim(), phone_number: addPhone.trim() || null, vehicle: addVehicle.trim() || null, plate: addPlate.trim() || null }).catch((e: any) =>
      alert(e.response?.data?.error === undefined ? "Run migration 013 first (couriers table)" : e.response?.data?.error));
    setAddName(""); setAddPhone(""); setAddVehicle(""); setAddPlate("");
    load();
  }

  return (
    <div>
      <PageHeader
        title="Delivery"
        subtitle={`${activeRows.length} active · ${doneRows.length} delivered today${avgDoor ? ` · avg door-to-door ${avgDoor} min` : ""}${codPending ? ` · COD out: EGP ${money(codPending)}` : ""}`}
        actions={
          branches.length > 1 && !staffBranch ? (
            <select value={branch} onChange={(e) => setBranch(e.target.value)}
              className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100">
              <option value="all">All branches</option>
              {branches.map((b: any) => (<option key={b.key} value={b.key}>{b.name}</option>))}
            </select>
          ) : undefined
        }
      />

      {/* driver-fed analytics: COD reconciliation (today) + route times (30 days) */}
      <div className="mb-4">
        <button onClick={() => setShowStats((s) => !s)} className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 hover:text-zinc-300">
          Delivery analytics {showStats ? "▾" : "▸"}
        </button>
        {showStats && (
          <div className="grid gap-3 md:grid-cols-3">
            <Card className="p-4">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500"><Banknote size={13} /> COD today (delivered)</div>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-zinc-400">Expected (cash orders)</span><b className="tabular-nums">EGP {money(stats.cod.expected)}</b></div>
                <div className="flex justify-between"><span className="text-zinc-400">Received (driver-recorded)</span><b className="tabular-nums">EGP {money(stats.cod.received)}</b></div>
                <div className="flex justify-between"><span className="text-zinc-400">Change given back</span><b className="tabular-nums">EGP {money(stats.cod.change)}</b></div>
                <div className="flex justify-between border-t border-zinc-800 pt-1"><span className="text-zinc-400">Net in rider pockets</span><b className="tabular-nums text-emerald-400">EGP {money(stats.cod.net)}</b></div>
                <div className="text-[11px] text-zinc-500">{stats.cod.recorded}/{stats.cod.of} cash orders recorded on the driver page</div>
              </div>
            </Card>
            <Card className="p-4">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500"><MapPin size={13} /> By destination (30 days)</div>
              {stats.dests.length === 0 ? <div className="text-xs text-zinc-500">No delivered orders yet.</div> : (
                <div className="space-y-1 text-sm">
                  {stats.dests.slice(0, 6).map((d) => (
                    <div key={d.area} className="flex items-center justify-between gap-2">
                      <span className="truncate text-zinc-300">{d.area}</span>
                      <span className="shrink-0 tabular-nums text-zinc-400">{d.n}× {d.avgMin != null ? `· avg ${d.avgMin}m` : ""} {d.avgFee != null ? `· fee ${d.avgFee}` : ""}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
            <Card className="p-4">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500"><Bike size={13} /> By rider (30 days)</div>
              {stats.courierRows.length === 0 ? <div className="text-xs text-zinc-500">Assign riders to see per-rider stats.</div> : (
                <div className="space-y-1 text-sm">
                  {stats.courierRows.slice(0, 6).map((c) => (
                    <div key={c.name} className="flex items-center justify-between gap-2">
                      <span className="truncate text-zinc-300">{c.name}</span>
                      <span className="shrink-0 tabular-nums text-zinc-400">{c.n} deliveries{c.avgMin != null ? ` · avg ${c.avgMin}m` : ""}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-4">
        <div className="space-y-3 lg:col-span-3">
          {rows.length === 0 ? (
            <Card><Empty text="No delivery orders today yet" /></Card>
          ) : (
            rows.map((o) => {
              const st = STAGE[o.status] || STAGE.pending;
              const done = ["delivered", "served", "paid"].includes(o.status);
              const roadMin = o.status === "out_for_delivery" ? mins(o.out_at || o.updated_at) : null;
              const seen = mins(o.courier_seen_at);
              const phone = String(o.phone_number || "");
              const guestCallable = /^[+\d][\d\s-]{6,}$/.test(phone);
              return (
                <Card key={o.id} className={`p-4 ${done ? "opacity-60" : ""}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span className="font-mono text-lg font-bold">{o.code}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${st.cls}`}>{st.label}</span>
                      {roadMin !== null && (
                        <span className={`flex items-center gap-1 text-xs ${roadMin >= 60 ? "font-bold text-red-400" : "text-zinc-400"}`}>
                          {roadMin >= 60 && <AlertTriangle size={12} />}<Clock size={11} /> {roadMin}m on the road
                        </span>
                      )}
                      {o.eta_extra_min > 0 && <span className="text-xs text-amber-300">+{o.eta_extra_min}m delay noted</span>}
                    </div>
                    <div className="flex items-center gap-2 text-sm font-bold tabular-nums">
                      {o.payment_method === "cash" ? (
                        <span className={`flex items-center gap-1 ${o.payment_status === "paid" ? "text-emerald-400" : "text-amber-300"}`}>
                          <Banknote size={14} /> COD EGP {money(o.total)}{o.payment_status === "paid" ? " ✓" : ""}
                        </span>
                      ) : (
                        <span className="text-zinc-300">EGP {money(o.total)} · {String(o.payment_method || "").toUpperCase()}</span>
                      )}
                    </div>
                  </div>

                  <div className="mt-2 grid gap-2 text-xs text-zinc-400 md:grid-cols-2">
                    <div className="space-y-1">
                      <div className="text-zinc-300">{o.diner_name || phone || "guest"}</div>
                      <div className="flex items-start gap-1"><MapPin size={12} className="mt-0.5 shrink-0" /> {o.address || "—"}</div>
                      <div className="flex gap-3">
                        {o.map_link && <a className="underline decoration-dotted" href={o.map_link} target="_blank" rel="noreferrer">guest map</a>}
                        {guestCallable && <a className="flex items-center gap-0.5 underline decoration-dotted" href={`tel:${phone.replace(/[\s-]/g, "")}`}><Phone size={10} /> call guest</a>}
                        {(o.items || []).length > 0 && <span className="text-zinc-500">{(o.items || []).map((i: any) => `${i.qty}× ${i.name}`).join(", ")}</span>}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <Bike size={13} className="text-zinc-500" />
                        <select value={o.courier_id || couriers.find((c) => c.name === o.courier_name)?.id || ""} disabled={done}
                          onChange={(e) => assign(o, e.target.value)}
                          className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 disabled:opacity-60">
                          <option value="">{o.courier_name ? o.courier_name : "Assign courier…"}</option>
                          {couriers.filter((c) => c.active !== false).map((c) => (
                            <option key={c.id} value={c.id}>{c.name}{c.phone_number ? ` · ${c.phone_number}` : ""}</option>
                          ))}
                        </select>
                        {!done && !o.courier_name && couriers.some((c) => c.active !== false) && (
                          <button onClick={() => autoAssign(o)} title="Smart assign — free rider first, nearby drops batch"
                            className="rounded-lg border border-sky-600/50 bg-sky-500/10 px-2 py-1 text-xs text-sky-300 hover:bg-sky-500/20">Auto</button>
                        )}
                      </div>
                      {driverLink(o) && !done && (
                        <div className="flex gap-2">
                          <button onClick={() => copyLink(o)}
                            className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-zinc-700 px-2 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800">
                            {copiedId === o.id ? <><Check size={12} className="text-emerald-400" /> copied</> : <><Copy size={12} /> driver link</>}
                          </button>
                          <button onClick={() => waSend(o)}
                            className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-emerald-600/50 bg-emerald-500/10 px-2 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/20">
                            <MessageCircle size={12} /> send on WhatsApp
                          </button>
                        </div>
                      )}
                      {o.courier_lat && o.courier_lng && !done && (
                        <a href={`https://maps.google.com/?q=${o.courier_lat},${o.courier_lng}`} target="_blank" rel="noreferrer"
                          className="flex items-center gap-1 text-xs text-sky-300 underline decoration-dotted">
                          <MapPin size={11} /> rider location {seen !== null ? `(${seen}m ago)` : ""}
                        </a>
                      )}
                      {done && o.delivered_at && (
                        <div className="flex items-center gap-1 text-xs text-emerald-400">
                          <BadgeCheck size={12} /> delivered {new Date(o.delivered_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          {mins(o.created_at) !== null && o.delivered_at ? ` · ${Math.round((new Date(o.delivered_at).getTime() - new Date(o.created_at).getTime()) / 60000)} min door-to-door` : ""}
                          {o.pod_url && (
                            <a href={o.pod_url} target="_blank" rel="noreferrer" className="ml-1 underline decoration-dotted hover:text-emerald-300">📸 proof</a>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })
          )}
        </div>

        {/* roster */}
        <div>
          <Card className="p-4">
            <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-zinc-300"><Bike size={14} /> Couriers</h2>
            <div className="mb-3 space-y-1.5">
              {couriers.length === 0 ? (
                <div className="text-xs text-zinc-500">No couriers yet — add your riders once, assign them forever.</div>
              ) : couriers.map((c) => (
                <div key={c.id} className={`rounded-lg bg-zinc-900 px-2.5 py-1.5 text-xs ${c.active === false ? "opacity-50" : ""}`}>
                <div className="flex items-center justify-between">
                  <button onClick={() => setEditCourier(editCourier?.id === c.id ? null : { ...c })} className="text-left">
                    <div className="font-medium text-zinc-200">{c.name}{c.vehicle ? ` · ${c.vehicle}` : ""}</div>
                    {c.phone_number && <div className="text-zinc-500">{c.phone_number}</div>}
                  </button>
                  <div className="flex items-center gap-1.5">
                    <button title={c.active === false ? "Reactivate" : "Deactivate"}
                      onClick={async () => { await api.patch(`/api/couriers/${c.id}`, { active: c.active === false }).catch(() => {}); load(); }}
                      className="text-zinc-500 hover:text-zinc-300">
                      <BadgeCheck size={13} className={c.active === false ? "" : "text-emerald-400"} />
                    </button>
                    <ArmButton title="Remove" armedLabel={`Remove ${c.name}?`} className="text-zinc-600 hover:text-red-400"
                      onConfirm={async () => { await api.delete(`/api/couriers/${c.id}`).catch(() => {}); load(); }}><X size={13} /></ArmButton>
                  </div>
                </div>
                {editCourier?.id === c.id && (
                  <div className="mt-2 space-y-1.5 border-t border-zinc-800 pt-2">
                    <Input placeholder="Name" value={editCourier.name || ""} onChange={(e: any) => setEditCourier({ ...editCourier, name: e.target.value })} />
                    <Input placeholder="Phone" value={editCourier.phone_number || ""} onChange={(e: any) => setEditCourier({ ...editCourier, phone_number: e.target.value })} />
                    <Input placeholder="Vehicle — scooter, bike…" value={editCourier.vehicle || ""} onChange={(e: any) => setEditCourier({ ...editCourier, vehicle: e.target.value })} />
                    <Input placeholder="Plate no. (shown to the customer)" value={editCourier.plate || ""} onChange={(e: any) => setEditCourier({ ...editCourier, plate: e.target.value })} />
                    <Input placeholder="National ID" value={editCourier.national_id || ""} onChange={(e: any) => setEditCourier({ ...editCourier, national_id: e.target.value })} />
                    <Input placeholder="Notes" value={editCourier.notes || ""} onChange={(e: any) => setEditCourier({ ...editCourier, notes: e.target.value })} />
                    <Btn className="w-full px-3 py-1.5 text-xs" onClick={async () => {
                      const { id, name, phone_number, vehicle, national_id, notes } = editCourier;
                      await api.patch(`/api/couriers/${id}`, { name, phone_number, vehicle, national_id, notes }).catch(() => {});
                      setEditCourier(null); load();
                    }}>Save</Btn>
                  </div>
                )}
                </div>
              ))}
            </div>
            <div className="space-y-1.5">
              <Input placeholder="Rider name" value={addName} onChange={(e: any) => setAddName(e.target.value)} />
              <Input placeholder="Phone (for WhatsApp send)" value={addPhone} onChange={(e: any) => setAddPhone(e.target.value)} />
              <Input placeholder="Vehicle (optional)" value={addVehicle} onChange={(e: any) => setAddVehicle(e.target.value)} />
              <Input placeholder="Plate no. (optional)" value={addPlate} onChange={(e: any) => setAddPlate(e.target.value)} />
              <Btn className="w-full px-3 py-1.5 text-xs" onClick={addCourier}><span className="flex items-center justify-center gap-1"><Plus size={12} /> Add courier</span></Btn>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
