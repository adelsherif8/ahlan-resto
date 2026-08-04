import { useEffect, useMemo, useState } from "react";
import {
  Search, Plus, Minus, X, Printer, ShoppingCart, User, ParkingSquare,
  Camera, Store, StickyNote, Trash2,
} from "lucide-react";
import { api, session } from "../config/api";
import { PageHeader, Btn, Empty } from "../components/ui";

// The POS walks the SAME option questions the bot asks — one config, two fronts.
// Pricing semantics mirror flows/order.js itemPrice: a chosen format's price
// replaces the base, every delta adds on top.

function money(n: any) {
  const v = Number(n || 0);
  return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
const norm = (s: any) => String(s || "").toLowerCase().trim();

function groupChoices(group: any, menu: any[]) {
  if (group.from_category) {
    const re = new RegExp(group.from_category, "i");
    return menu.filter((m) => re.test(String(m.category || ""))).map((m) => ({ name: m.name }));
  }
  return (group.choices || []).filter((c: any) => c?.name);
}
function groupApplies(group: any, picked: Record<string, any>) {
  if (!group.when) return true;
  return Object.entries(group.when).every(([key, want]) => {
    const got = picked[key];
    if (!got) return false;
    const wants = Array.isArray(want) ? want : [want];
    return wants.some((w: any) => norm(w) === norm(got) || norm(got).includes(norm(w)));
  });
}
function priceOf(item: any, picked: Record<string, any>, menu: any[]) {
  let base = Number(item.price) || 0, delta = 0;
  for (const g of item.options || []) {
    if (g.key === "slots") continue;
    const chosen = picked[g.key];
    for (const name of Array.isArray(chosen) ? chosen : [chosen].filter(Boolean)) {
      const c = groupChoices(g, menu).find((x: any) => norm(x.name) === norm(name));
      if (!c) continue;
      if (c.price != null) base = Number(c.price);
      if (c.delta) delta += Number(c.delta);
    }
  }
  return base + delta;
}

type CartLine = { uid: string; item: any; qty: number; options: Record<string, any>; notes: string; unit: number };

export default function Pos() {
  const [menu, setMenu] = useState<any[]>([]);
  const [payments, setPayments] = useState<any>({});
  const [branches, setBranches] = useState<any[]>([]);
  const staffBranch = session().branch || "";
  const [cat, setCat] = useState("");
  const [q, setQ] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [configuring, setConfiguring] = useState<any | null>(null);
  const [orderType, setOrderType] = useState("pickup");
  const [branchKey, setBranchKey] = useState(staffBranch || "");
  const [table, setTable] = useState("");
  const [address, setAddress] = useState("");
  const [pay, setPay] = useState("cash");
  const [phone, setPhone] = useState("");
  const [guest, setGuest] = useState<any | null>(null);
  const [printOnCreate, setPrintOnCreate] = useState(localStorage.getItem("pos_print") !== "off");
  const [parked, setParked] = useState<any[]>(() => { try { return JSON.parse(localStorage.getItem("pos_parked") || "[]"); } catch { return []; } });
  const [saving, setSaving] = useState(false);
  const [createdCode, setCreatedCode] = useState<string | null>(null);

  useEffect(() => {
    api.get("/api/menu").then((r) => {
      const av = (r.data || []).filter((m: any) => m.available);
      setMenu(av);
      setCat(av[0]?.category || "");
    }).catch(() => {});
    api.get("/api/settings").then((r) => {
      setPayments(r.data?.payments || {});
      setBranches(r.data?.basic_info?.branches || []);
    }).catch(() => {});
  }, []);

  // guest lookup by phone — the CRM knows their name and addresses
  useEffect(() => {
    const p = phone.trim();
    if (p.length < 6) { setGuest(null); return; }
    const t = setTimeout(() => {
      api.get("/api/diners", { params: { q: p } }).then((r) => {
        const hit = (r.data || []).find((d: any) => String(d.phone_number || "").replace(/[^\d]/g, "").endsWith(p.replace(/[^\d]/g, "")));
        setGuest(hit || null);
      }).catch(() => setGuest(null));
    }, 300);
    return () => clearTimeout(t);
  }, [phone]);

  const cats = [...new Set(menu.map((m) => m.category))];
  const shown = useMemo(() => {
    let list = menu;
    if (q.trim()) {
      const n = q.trim().toLowerCase();
      list = list.filter((m) => m.name.toLowerCase().includes(n));
    } else list = list.filter((m) => m.category === cat);
    return list;
  }, [menu, cat, q]);

  function tapItem(item: any) {
    const hasQuestions = (item.options || []).some((g: any) => g.key === "slots" || groupChoices(g, menu).length);
    if (hasQuestions) setConfiguring(item);
    else addLine(item, {}, "", 1);
  }
  function addLine(item: any, options: Record<string, any>, notes: string, qty: number) {
    setCart((c) => [...c, { uid: Math.random().toString(36).slice(2), item, qty, options, notes, unit: priceOf(item, options, menu) }]);
    setConfiguring(null);
  }

  const round = (n: number) => Math.round(n * 100) / 100;
  const rateOf = (...keys: string[]) => { for (const k of keys) { const v = Number(payments[k]); if (Number.isFinite(v) && v > 0) return v > 1 ? v / 100 : v; } return 0; };
  const subtotal = round(cart.reduce((s, l) => s + l.unit * l.qty, 0));
  const service = orderType === "dine_in" ? round(subtotal * rateOf("service_charge", "service_charge_pct")) : 0;
  const vat = round(subtotal * rateOf("tax", "tax_pct", "vat_pct"));
  const delivery = orderType === "delivery" ? round(Number(payments.delivery_fee) || 0) : 0;
  const total = round(subtotal + service + vat + delivery);

  function park() {
    if (!cart.length) return;
    const entry = {
      id: Math.random().toString(36).slice(2), at: new Date().toISOString(),
      label: guest?.name || phone.trim() || `${cart.length} items`,
      cart, orderType, branchKey, table, address, pay, phone,
    };
    const next = [entry, ...parked].slice(0, 12);
    setParked(next);
    localStorage.setItem("pos_parked", JSON.stringify(next));
    clearAll();
  }
  function resume(p: any) {
    setCart(p.cart); setOrderType(p.orderType); setBranchKey(p.branchKey); setTable(p.table);
    setAddress(p.address); setPay(p.pay); setPhone(p.phone || "");
    const next = parked.filter((x) => x.id !== p.id);
    setParked(next);
    localStorage.setItem("pos_parked", JSON.stringify(next));
  }
  function clearAll() {
    setCart([]); setTable(""); setAddress(""); setPhone(""); setGuest(null); setCreatedCode(null);
  }

  async function create() {
    if (!cart.length || saving) return;
    setSaving(true);
    try {
      const { data: created } = await api.post("/api/orders", {
        items: cart.map((l) => ({ name: l.item.name, qty: l.qty, price: l.unit, options: l.options, notes: l.notes || null })),
        order_type: orderType, branch: branchKey || null,
        table_number: table.trim() || null,
        address: address.trim() || (guest?.preferences?.addresses?.[0]?.text ?? null),
        payment_method: pay,
        diner_name: guest?.name || guest?.wa_profile_name || null,
        phone_number: phone.trim() ? `+${phone.replace(/[^\d]/g, "")}` : null,
      });
      setCreatedCode(created?.code || "created");
      if (printOnCreate && created) printTicket(created);
      setCart([]);
      setTimeout(() => setCreatedCode(null), 4000);
    } catch (e: any) {
      alert(e.response?.data?.error || "Failed to create the order");
    }
    setSaving(false);
  }

  function printTicket(o: any) {
    const rows = (o.items || []).map((i: any) => {
      const mods = Object.entries(i.options || {}).filter(([k]) => k !== "slots")
        .map(([, v]) => (Array.isArray(v) ? v.join(", ") : v));
      const slots = Array.isArray(i.options?.slots)
        ? i.options.slots.map((sl: any, si: number) => `${si + 1}) ${Object.entries(sl || {}).filter(([f]) => f !== "notes").map(([, x]) => x).join(" + ")}${sl?.notes ? ` — ${sl.notes}` : ""}`)
        : [];
      return `<div class="r"><b>${i.qty}x ${i.name}</b><span>${money(Number(i.unit_price ?? i.price) * Number(i.qty))}</span></div>` +
        [...mods, ...slots, ...(i.notes ? [`* ${i.notes}`] : [])].map((m) => `<div class="m">&raquo; ${m}</div>`).join("");
    }).join("");
    const w = window.open("", "_blank", "width=330,height=640");
    if (!w) return;
    w.document.write(`<html><head><title>${o.code}</title><style>
      body{font-family:ui-monospace,Menlo,monospace;width:280px;margin:8px auto;color:#000}
      .c{text-align:center}.big{font-size:30px;font-weight:800;letter-spacing:3px}
      .r{display:flex;justify-content:space-between;margin:2px 0}.m{color:#444;font-size:11px;padding-left:12px}
      hr{border:none;border-top:1px dashed #888;margin:6px 0}
    </style></head><body>
      <div class="c"><b>${String(o.order_type || "").replace("_", "-").toUpperCase()}${o.table_number ? " · T" + o.table_number : ""}</b></div>
      <div class="c big">${o.code}</div>
      <hr>${rows}<hr>
      <div class="r"><b>TOTAL</b><b>EGP ${money(o.total)}</b></div>
      ${o.payment_method ? `<div>PAYMENT: ${String(o.payment_method).toUpperCase()}</div>` : ""}
      ${o.address ? `<div>DELIVER TO: ${o.address}</div>` : ""}
    </body></html>`);
    w.document.close(); w.focus();
    setTimeout(() => { w.print(); w.close(); }, 250);
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="POS"
        subtitle="Phone orders & walk-ups — same questions, same prices, same board as the bot"
        actions={
          parked.length > 0 ? (
            <div className="flex items-center gap-1.5">
              <ParkingSquare size={14} className="text-zinc-500" />
              {parked.map((p) => (
                <button key={p.id} onClick={() => resume(p)} title={new Date(p.at).toLocaleTimeString()}
                  className="rounded-full bg-zinc-800 px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-zinc-700">
                  {p.label}
                </button>
              ))}
            </div>
          ) : undefined
        }
      />

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-3">
        {/* ---------- menu picker ---------- */}
        <div className="flex min-h-0 flex-col lg:col-span-2">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…"
                className="w-36 rounded-lg border border-zinc-800 bg-zinc-900 py-1.5 pl-8 pr-2 text-xs text-zinc-100 outline-none focus:border-zinc-600" />
            </div>
            {cats.map((c) => (
              <button key={c} onClick={() => { setCat(c); setQ(""); }}
                className={`rounded-full px-2.5 py-1 text-[11px] ${cat === c && !q ? "bg-zinc-200 font-semibold text-zinc-900" : "bg-zinc-800/70 text-zinc-400 hover:text-zinc-200"}`}>
                {c}
              </button>
            ))}
          </div>
          <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3 xl:grid-cols-4">
            {shown.map((m) => (
              <button key={m.id} onClick={() => tapItem(m)}
                className="flex flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60 text-left transition hover:border-zinc-600">
                {m.photo_url ? (
                  <img src={m.photo_url} alt="" className="h-20 w-full object-cover" />
                ) : (
                  <div className="flex h-20 w-full items-center justify-center bg-zinc-900 text-zinc-700"><Camera size={18} /></div>
                )}
                <div className="p-2">
                  <div className="truncate text-xs font-medium text-zinc-200">{m.name}</div>
                  <div className="text-[11px] text-zinc-500">
                    {(m.options || []).some((g: any) => (g.choices || []).some((c: any) => c.price != null)) ? "from " : ""}EGP {money(m.price)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* ---------- cart ---------- */}
        <div className="flex min-h-0 flex-col rounded-2xl border border-zinc-800 bg-zinc-900/40">
          <div className="border-b border-zinc-800 p-3">
            <div className="relative mb-2">
              <User size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Guest phone (CRM lookup)…"
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 py-1.5 pl-8 pr-2 text-xs text-zinc-100 outline-none focus:border-zinc-600" />
            </div>
            {guest && (
              <div className="mb-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] text-zinc-200">
                {guest.name || guest.wa_profile_name} · {guest.visit_count} visit{Number(guest.visit_count) === 1 ? "" : "s"}
                {guest.preferences?.addresses?.[0] && orderType === "delivery" && !address && (
                  <button onClick={() => setAddress(guest.preferences.addresses[0].text)} className="ml-1 underline decoration-dotted">
                    use saved address
                  </button>
                )}
              </div>
            )}
            <div className="flex gap-1">
              {[["dine_in", "Dine-in"], ["pickup", "Pickup"], ["delivery", "Delivery"]].map(([k, l]) => (
                <button key={k} onClick={() => setOrderType(k)}
                  className={`flex-1 rounded-lg px-2 py-1.5 text-[11px] ${orderType === k ? "bg-zinc-200 font-semibold text-zinc-900" : "bg-zinc-800/70 text-zinc-400"}`}>
                  {l}
                </button>
              ))}
            </div>
            <div className="mt-1.5 flex gap-1.5">
              {branches.length > 1 && (
                <select value={branchKey} onChange={(e) => setBranchKey(e.target.value)} disabled={!!staffBranch}
                  className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[11px] text-zinc-100">
                  <option value="">Branch…</option>
                  {branches.map((b: any) => (<option key={b.key} value={b.key}>{b.name}</option>))}
                </select>
              )}
              {orderType === "dine_in" && (
                <input value={table} onChange={(e) => setTable(e.target.value)} placeholder="Table"
                  className="w-16 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[11px] text-zinc-100" />
              )}
              <select value={pay} onChange={(e) => setPay(e.target.value)}
                className="rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[11px] text-zinc-100">
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="instapay">InstaPay</option>
              </select>
            </div>
            {orderType === "delivery" && (
              <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Delivery address"
                className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[11px] text-zinc-100" />
            )}
          </div>

          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3">
            {cart.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-zinc-600">
                <ShoppingCart size={22} />
                <span className="text-xs">Tap items to build the order</span>
              </div>
            ) : cart.map((l) => (
              <div key={l.uid} className="rounded-lg border border-zinc-800 bg-zinc-900/70 px-2.5 py-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-zinc-200">{l.item.name}</span>
                  <span className="tabular-nums text-zinc-300">{money(l.unit * l.qty)}</span>
                </div>
                {Object.entries(l.options).filter(([k]) => k !== "slots").map(([k, v]) => (
                  <div key={k} className="text-[11px] text-zinc-500">{Array.isArray(v) ? v.join(", ") : String(v)}</div>
                ))}
                {Array.isArray(l.options.slots) && l.options.slots.map((sl: any, si: number) => (
                  <div key={si} className="text-[11px] text-zinc-500">{si + 1}) {Object.entries(sl || {}).filter(([f]) => f !== "notes").map(([, x]) => x).join(" + ")}{sl?.notes ? ` — ${sl.notes}` : ""}</div>
                ))}
                {l.notes && <div className="flex items-center gap-1 text-[11px] text-amber-300"><StickyNote size={10} /> {l.notes}</div>}
                <div className="mt-1 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => setCart((c) => c.map((x) => x.uid === l.uid ? { ...x, qty: Math.max(1, x.qty - 1) } : x))}
                      className="rounded border border-zinc-700 p-0.5 text-zinc-400"><Minus size={10} /></button>
                    <span className="w-4 text-center font-bold tabular-nums">{l.qty}</span>
                    <button onClick={() => setCart((c) => c.map((x) => x.uid === l.uid ? { ...x, qty: x.qty + 1 } : x))}
                      className="rounded border border-zinc-700 p-0.5 text-zinc-400"><Plus size={10} /></button>
                  </div>
                  <button onClick={() => setCart((c) => c.filter((x) => x.uid !== l.uid))} className="text-zinc-600 hover:text-red-400"><Trash2 size={12} /></button>
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-zinc-800 p-3 text-xs">
            <div className="space-y-0.5 text-zinc-400">
              <div className="flex justify-between"><span>Subtotal</span><span className="tabular-nums">{money(subtotal)}</span></div>
              {service > 0 && <div className="flex justify-between"><span>Service</span><span className="tabular-nums">{money(service)}</span></div>}
              {vat > 0 && <div className="flex justify-between"><span>VAT</span><span className="tabular-nums">{money(vat)}</span></div>}
              {delivery > 0 && <div className="flex justify-between"><span>Delivery</span><span className="tabular-nums">{money(delivery)}</span></div>}
              <div className="flex justify-between pt-1 text-sm font-bold text-zinc-100"><span>TOTAL</span><span className="tabular-nums">EGP {money(total)}</span></div>
            </div>
            <label className="mt-2 flex items-center gap-1.5 text-[11px] text-zinc-400">
              <input type="checkbox" checked={printOnCreate}
                onChange={(e) => { setPrintOnCreate(e.target.checked); localStorage.setItem("pos_print", e.target.checked ? "on" : "off"); }} />
              <Printer size={11} /> print ticket on create
            </label>
            <div className="mt-2 flex gap-2">
              <button onClick={park} disabled={!cart.length}
                className="flex items-center gap-1 rounded-xl border border-zinc-700 px-3 py-2 text-xs text-zinc-300 disabled:opacity-40">
                <ParkingSquare size={13} /> Park
              </button>
              <Btn onClick={create} className={`flex-1 ${cart.length ? "" : "pointer-events-none opacity-50"}`}>
                {saving ? "Creating…" : createdCode ? `${createdCode} on the board ✓` : `Create · EGP ${money(total)}`}
              </Btn>
            </div>
          </div>
        </div>
      </div>

      {configuring && (
        <OptionWalker item={configuring} menu={menu} onCancel={() => setConfiguring(null)} onDone={addLine} />
      )}
    </div>
  );
}

// The same questions the bot asks, as taps: format → size → fries → drink,
// or per-slot sandwich picks for bundles. Price updates live.
function OptionWalker({ item, menu, onCancel, onDone }: any) {
  const [picked, setPicked] = useState<Record<string, any>>({});
  const [slots, setSlots] = useState<any[]>(() => {
    const sg = (item.options || []).find((g: any) => g.key === "slots");
    return sg ? Array.from({ length: Number(sg.count) || 2 }, () => ({})) : [];
  });
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState("");
  const slotsGroup = (item.options || []).find((g: any) => g.key === "slots");
  const groups = (item.options || []).filter((g: any) => g.key !== "slots" && groupApplies(g, picked) && groupChoices(g, menu).length);
  const unit = priceOf(item, picked, menu);

  const missing = groups.filter((g: any) => g.required && !picked[g.key]).length +
    (slotsGroup ? slots.filter((sl) => !(slotsGroup.slot_groups || []).filter((sg: any) => !sg.free).every((sg: any) => sl[sg.key])).length : 0);

  function pick(g: any, name: string) {
    setPicked((p) => {
      const next: Record<string, any> = { ...p, [g.key]: name };
      // a format change can invalidate conditional answers — drop the orphans
      for (const other of item.options || []) {
        if (other.key !== "slots" && other.when && !groupApplies(other, next)) delete next[other.key];
      }
      return next;
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div className="grid max-h-[86vh] w-full max-w-lg grid-rows-[auto_1fr_auto] overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
          <div className="text-sm font-semibold">{item.name}</div>
          <button onClick={onCancel}><X size={16} className="text-zinc-500 hover:text-zinc-200" /></button>
        </div>

        <div className="min-h-0 overflow-y-auto p-4">
          {groups.map((g: any) => (
            <div key={g.key} className="mb-4">
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">{g.label || g.key}</div>
              <div className="flex flex-wrap gap-1.5">
                {groupChoices(g, menu).map((c: any) => (
                  <button key={c.name} onClick={() => pick(g, c.name)}
                    className={`rounded-lg border px-2.5 py-1.5 text-xs ${norm(picked[g.key]) === norm(c.name) ? "border-zinc-300 bg-zinc-200 font-semibold text-zinc-900" : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"}`}>
                    {c.name}{c.price != null ? ` · ${money(c.price)}` : c.delta ? ` +${money(c.delta)}` : ""}
                  </button>
                ))}
              </div>
            </div>
          ))}

          {slotsGroup && slots.map((sl, si) => (
            <div key={si} className="mb-3 rounded-xl border border-zinc-800 p-3">
              <div className="mb-1.5 text-xs font-semibold text-zinc-300">Sandwich {si + 1}</div>
              {(slotsGroup.slot_groups || []).map((sg: any) => sg.free ? (
                <input key={sg.key} value={sl[sg.key] || ""} placeholder={`${sg.label || sg.key} (optional)`}
                  onChange={(e) => setSlots((xs) => xs.map((x, i) => (i === si ? { ...x, [sg.key]: e.target.value } : x)))}
                  className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100" />
              ) : (
                <div key={sg.key} className="flex flex-wrap gap-1.5">
                  {(sg.choices || []).map((c: any) => (
                    <button key={c.name}
                      onClick={() => setSlots((xs) => xs.map((x, i) => (i === si ? { ...x, [sg.key]: c.name } : x)))}
                      className={`rounded-lg border px-2 py-1 text-[11px] ${norm(sl[sg.key]) === norm(c.name) ? "border-zinc-300 bg-zinc-200 font-semibold text-zinc-900" : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"}`}>
                      {c.name}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          ))}

          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Item notes — no onion, extra sauce…"
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-xs text-zinc-100" />
        </div>

        <div className="flex items-center justify-between border-t border-zinc-800 px-5 py-3">
          <div className="flex items-center gap-2">
            <button onClick={() => setQty((n) => Math.max(1, n - 1))} className="rounded border border-zinc-700 p-1 text-zinc-300"><Minus size={12} /></button>
            <span className="w-5 text-center text-sm font-bold tabular-nums">{qty}</span>
            <button onClick={() => setQty((n) => n + 1)} className="rounded border border-zinc-700 p-1 text-zinc-300"><Plus size={12} /></button>
          </div>
          <Btn
            onClick={() => onDone(item, slotsGroup ? { ...picked, slots } : picked, notes.trim(), qty)}
            className={missing ? "pointer-events-none opacity-50" : ""}
          >
            {missing ? `${missing} choice${missing > 1 ? "s" : ""} left` : `Add ${qty} · EGP ${money(unit * qty)}`}
          </Btn>
        </div>
      </div>
    </div>
  );
}
