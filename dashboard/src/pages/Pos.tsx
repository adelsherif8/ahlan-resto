import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search, Plus, Minus, X, Printer, ShoppingCart, User, ParkingSquare,
  Camera, StickyNote, Trash2, Star, Flame, Leaf, Pencil, Eraser, Check,
  Delete, Expand, CornerDownLeft, Sparkles, ArrowRight, BadgePercent, Receipt, UserCog, SplitSquareHorizontal,
} from "lucide-react";
import { api, session } from "../config/api";
import { printTicket as printSharedTicket } from "../lib/ticket";
import { PageHeader, Btn } from "../components/ui";

// The POS walks the SAME option questions the bot asks — one config, two fronts.
// Pricing semantics mirror flows/order.js itemPrice: a chosen format's price
// replaces the base, every delta adds on top.

import { money } from "../lib/format";
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

// every category gets a stable hue (golden angle) — the eye finds color before text
const catHue = (cats: string[], c: string) => (Math.max(0, cats.indexOf(c)) * 137.5) % 360;
const catColor = (cats: string[], c: string) => `hsl(${catHue(cats, c)} 60% 55%)`;

// big-button numeric keypad — cashiers type "12" faster than they tap + eleven times
function Keypad({ value, onDone, onCancel }: { value: number; onDone: (n: number) => void; onCancel: () => void }) {
  const [v, setV] = useState("");
  const shown = v === "" ? String(value) : v;
  const commit = () => { const n = parseInt(v || String(value), 10); onDone(Math.min(99, Math.max(1, Number.isFinite(n) ? n : value))); };
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div className="w-56 rounded-2xl border border-zinc-800 bg-zinc-950 p-3" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 rounded-xl bg-zinc-900 px-3 py-2 text-right text-2xl font-bold tabular-nums text-zinc-100">{shown}</div>
        <div className="grid grid-cols-3 gap-1.5">
          {["1","2","3","4","5","6","7","8","9"].map((d) => (
            <button key={d} onClick={() => setV((x) => (x + d).slice(0, 2))}
              className="rounded-xl border border-zinc-800 py-3 text-lg font-semibold text-zinc-200 active:scale-95 active:bg-zinc-800">{d}</button>
          ))}
          <button onClick={() => setV((x) => x.slice(0, -1))} className="flex items-center justify-center rounded-xl border border-zinc-800 py-3 text-zinc-400 active:scale-95"><Delete size={18} /></button>
          <button onClick={() => setV((x) => (x + "0").slice(0, 2))} className="rounded-xl border border-zinc-800 py-3 text-lg font-semibold text-zinc-200 active:scale-95 active:bg-zinc-800">0</button>
          <button onClick={commit} className="flex items-center justify-center rounded-xl py-3 font-bold active:scale-95" style={{ backgroundColor: "var(--accent)", color: "var(--accent-contrast)" }}><Check size={18} /></button>
        </div>
      </div>
    </div>
  );
}

const lineKey = (l: { item: any; options: any; notes: string }) =>
  `${l.item.id}|${JSON.stringify(l.options)}|${l.notes}`;

export default function Pos() {
  const [menu, setMenu] = useState<any[]>([]);
  const [payments, setPayments] = useState<any>({});
  const [branches, setBranches] = useState<any[]>([]);
  const staffBranch = session().branch || "";
  const [cat, setCat] = useState("");
  const [q, setQ] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [configuring, setConfiguring] = useState<{ item: any; line?: CartLine } | null>(null);
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
  const [touch, setTouch] = useState(localStorage.getItem("pos_touch") === "on");
  const [keypadLine, setKeypadLine] = useState<CartLine | null>(null);
  const [posCfg, setPosCfg] = useState<any>({});
  const [cashier, setCashier] = useState<string>(localStorage.getItem("pos_cashier") || session().name || "POS");
  const [switching, setSwitching] = useState(false);
  const [discount, setDiscount] = useState<{ amount: number; reason: string } | null>(null);
  const [discOpen, setDiscOpen] = useState(false);
  const [tip, setTip] = useState(0);
  const [split, setSplit] = useState<{ method: string; amount: string }[] | null>(null);
  const [report, setReport] = useState<any | null>(null);
  const [say, setSay] = useState("");
  const [saying, setSaying] = useState(false);
  const [sayNote, setSayNote] = useState<string | null>(null);
  const [upsell, setUpsell] = useState<{ source: string; items: any[] } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get("/api/menu").then((r) => {
      const av = (r.data || []).filter((m: any) => m.available);
      setMenu(av);
      setCat(av[0]?.category || "");
    }).catch(() => {});
    api.get("/api/settings").then((r) => {
      setPayments(r.data?.payments || {});
      setBranches(r.data?.basic_info?.branches || []);
      setPosCfg(r.data?.pos || {});
    }).catch(() => {});
  }, []);

  // "/" jumps to search from anywhere — cashiers live on the keyboard
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "SELECT") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
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
  // PLU entry: "2 ic ⏎" = 2× Iconic. Leading number is qty; the rest matches by
  // name prefix, then by word initials ("lf" → Loaded Fries).
  const plu = useMemo(() => {
    const t = q.trim().toLowerCase();
    const m2 = t.match(/^(\d{1,2})\s+(.+)$/);
    const qty = m2 ? parseInt(m2[1], 10) : 1;
    const term = (m2 ? m2[2] : t).trim();
    if (!term) return null;
    const scored = menu.map((m) => {
      const name = m.name.toLowerCase();
      const words = name.split(/\s+/);
      let score = 0;
      if (name.startsWith(term)) score = 3;
      else if (words.some((w: string) => w.startsWith(term))) score = 2;
      else if (term.length >= 2 && words.map((w: string) => w[0]).join("").startsWith(term)) score = 1;
      else if (name.includes(term)) score = 0.5;
      return { m, score };
    }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.m.name.length - b.m.name.length);
    return scored.length ? { item: scored[0].m, qty } : null;
  }, [menu, q]);
  const shown = useMemo(() => {
    let list = menu;
    if (q.trim()) {
      const t = q.trim().toLowerCase().replace(/^\d{1,2}\s+/, "");
      list = list.filter((m) => m.name.toLowerCase().includes(t) || String(m.description || "").toLowerCase().includes(t));
      if (plu && !list.some((m) => m.id === plu.item.id)) list = [plu.item, ...list];
    } else list = list.filter((m) => m.category === cat);
    return list;
  }, [menu, cat, q, plu]);
  function pluAdd() {
    if (!plu) return;
    const hasQuestions = (plu.item.options || []).some((g: any) => g.key === "slots" || groupChoices(g, menu).length);
    if (hasQuestions) setConfiguring({ item: plu.item, presetQty: plu.qty } as any);
    else addLine(plu.item, {}, "", plu.qty);
    setQ("");
  }

  const inCartQty = useMemo(() => {
    const map: Record<string, number> = {};
    for (const l of cart) map[l.item.id] = (map[l.item.id] || 0) + l.qty;
    return map;
  }, [cart]);

  function tapItem(item: any) {
    const hasQuestions = (item.options || []).some((g: any) => g.key === "slots" || groupChoices(g, menu).length);
    if (hasQuestions || item.description || item.ingredients) setConfiguring({ item });
    else addLine(item, {}, "", 1);
  }
  function addLine(item: any, options: Record<string, any>, notes: string, qty: number, editingUid?: string) {
    // cross-sell: the menu's own pairs_with becomes one-tap add chips
    if (!editingUid && item.pairs_with) {
      const names = String(item.pairs_with).split(/[,·+&]| and /i).map((x: string) => x.trim()).filter(Boolean);
      const hits = names
        .map((n2: string) => menu.find((m) => m.name.toLowerCase() === n2.toLowerCase() || m.name.toLowerCase().includes(n2.toLowerCase())))
        .filter(Boolean).filter((m: any) => m.id !== item.id).slice(0, 3);
      setUpsell(hits.length ? { source: item.name, items: hits } : null);
    }
    setCart((c) => {
      const fresh: CartLine = { uid: Math.random().toString(36).slice(2), item, qty, options, notes, unit: priceOf(item, options, menu) };
      if (editingUid) return c.map((x) => (x.uid === editingUid ? { ...fresh, uid: editingUid } : x));
      // identical line already in the cart → just bump its qty
      const twin = c.find((x) => lineKey(x) === lineKey(fresh));
      if (twin) return c.map((x) => (x.uid === twin.uid ? { ...x, qty: x.qty + qty } : x));
      return [...c, fresh];
    });
    setConfiguring(null);
  }

  const round = (n: number) => Math.round(n * 100) / 100;
  const rateOf = (...keys: string[]) => { for (const k of keys) { const v = Number(payments[k]); if (Number.isFinite(v) && v > 0) return v > 1 ? v / 100 : v; } return 0; };
  const subtotal = round(cart.reduce((s, l) => s + l.unit * l.qty, 0));
  const disc = discount ? Math.min(discount.amount, subtotal) : 0;
  const service = orderType === "dine_in" ? round(subtotal * rateOf("service_charge", "service_charge_pct")) : 0;
  const vat = round(subtotal * rateOf("tax", "tax_pct", "vat_pct"));
  const delivery = orderType === "delivery" ? round(Number(payments.delivery_fee) || 0) : 0;
  const total = round(subtotal - disc + service + vat + delivery);
  const splitSum = split ? round(split.reduce((s2, x) => s2 + (Number(x.amount) || 0), 0)) : 0;
  const managers = (posCfg.cashiers || []).filter((c2: any) => c2.manager);
  // a discount needs a manager's PIN — but only when managers are configured
  const managerOk = (pin: string) => !managers.length || managers.some((c2: any) => String(c2.pin) === pin);
  const itemCount = cart.reduce((s, l) => s + l.qty, 0);

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
    setCart([]); setTable(""); setAddress(""); setPhone(""); setGuest(null); setCreatedCode(null); setUpsell(null);
  }

  // the cashier types the order as it's spoken — the bot's extraction brain
  // parses it (Arabic/Franco included); CODE matches names and prices
  async function speakOrder() {
    const text = say.trim();
    if (!text || saying) return;
    setSaying(true);
    setSayNote(null);
    try {
      const { data } = await api.post("/api/orders/pos-extract", { text });
      let added = 0;
      for (const l of data?.lines || []) {
        const item = menu.find((m) => m.id === l.id);
        if (!item) continue;
        addLine(item, {}, l.notes || "", l.qty);
        added++;
      }
      const unknown = data?.unknown || [];
      if (!added && !unknown.length) setSayNote("Nothing matched the menu");
      else if (unknown.length) setSayNote(`Couldn't find: ${unknown.join(", ")}`);
      if (added) setSay("");
    } catch (e: any) {
      setSayNote(e.response?.data?.error || "Extraction failed — try again");
    }
    setSaying(false);
  }

  async function create() {
    if (!cart.length || saving) return;
    setSaving(true);
    try {
      if (split && Math.abs(splitSum - total) > 0.5) { alert("Split payments must add up to the total"); setSaving(false); return; }
      const { data: created } = await api.post("/api/orders", {
        items: cart.map((l) => ({ name: l.item.name, qty: l.qty, price: l.unit, options: l.options, notes: l.notes || null })),
        order_type: orderType, branch: branchKey || null,
        table_number: table.trim() || null,
        address: address.trim() || (guest?.preferences?.addresses?.[0]?.text ?? null),
        payment_method: pay,
        diner_name: guest?.name || guest?.wa_profile_name || null,
        phone_number: phone.trim() ? `+${phone.replace(/[^\d]/g, "")}` : null,
        ...(disc > 0 ? { discount: disc, discount_reason: discount?.reason || null } : {}),
        ...(tip > 0 ? { tip } : {}),
        cashier,
        ...(split && split.length > 1 ? { payments: split.map((x) => ({ method: x.method, amount: Number(x.amount) || 0 })) } : {}),
      });
      setCreatedCode(created?.code || "created");
      if (printOnCreate && created) printTicket(created);
      setCart([]); setDiscount(null); setTip(0); setSplit(null); setUpsell(null);
      setTimeout(() => setCreatedCode(null), 4000);
    } catch (e: any) {
      alert(e.response?.data?.error || "Failed to create the order");
    }
    setSaving(false);
  }

  function printTicket(o: any) {
    printSharedTicket(o, { branchName: branches.find((b: any) => b.key === o.branch)?.name });
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="POS"
        subtitle="Phone orders & walk-ups — same questions, same prices, same board as the bot"
        actions={
          <div className="flex items-center gap-1.5">
            {parked.length > 0 && <ParkingSquare size={14} className="text-zinc-500" />}
            {parked.map((p) => (
              <button key={p.id} onClick={() => resume(p)} title={new Date(p.at).toLocaleTimeString()}
                className="rounded-full bg-zinc-800 px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-zinc-700">
                {p.label}
              </button>
            ))}
            <button onClick={() => setSwitching(true)} title="Switch cashier"
              className="flex items-center gap-1.5 rounded-full border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800">
              <UserCog size={12} /> {cashier}
            </button>
            <button onClick={async () => { const { data } = await api.get("/api/orders/shift-report", { params: { branch: branchKey || "all" } }).catch(() => ({ data: null })); if (data) setReport(data); }}
              title="X report — the day so far" className="flex items-center gap-1.5 rounded-full border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800">
              <Receipt size={12} /> Shift
            </button>
          </div>
        }
      />

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-3">
        {/* ---------- menu picker ---------- */}
        <div className="flex min-h-0 flex-col lg:col-span-2">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="2 ic ⏎  ·  ( / )"
                onKeyDown={(e) => { if (e.key === "Enter") pluAdd(); }}
                className="w-40 rounded-lg border border-zinc-800 bg-zinc-900 py-1.5 pl-8 pr-2 text-xs text-zinc-100 outline-none focus:border-zinc-600" />
            </div>
            {plu && (
              <button onClick={pluAdd} className="flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-300">
                <CornerDownLeft size={10} /> {plu.qty}× {plu.item.name}
              </button>
            )}
            <button onClick={() => { const n = !touch; setTouch(n); localStorage.setItem("pos_touch", n ? "on" : "off"); }}
              title="Touch mode — bigger targets for tablets"
              className={`ml-auto rounded-lg border p-1.5 ${touch ? "border-zinc-400 text-zinc-200" : "border-zinc-800 text-zinc-600 hover:text-zinc-400"}`}>
              <Expand size={13} />
            </button>
            {cats.map((c) => {
              const count = menu.filter((m) => m.category === c).length;
              return (
                <button key={c} onClick={() => { setCat(c); setQ(""); }}
                  className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 ${touch ? "text-xs" : "text-[11px]"} ${cat === c && !q ? "bg-zinc-200 font-semibold text-zinc-900" : "bg-zinc-800/70 text-zinc-400 hover:text-zinc-200"}`}>
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: catColor(cats, c) }} />
                  {c} <span className="text-zinc-600">{count}</span>
                </button>
              );
            })}
          </div>
          <div className="mb-2 flex items-center gap-1.5">
            <div className="relative flex-1">
              <Sparkles size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input value={say} onChange={(e) => setSay(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") speakOrder(); }}
                placeholder={'Type the order as spoken — "2 iconic meals no pickles and a sprite" (Arabic works)'}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 py-2 pl-8 pr-2 text-xs text-zinc-100 outline-none focus:border-zinc-600" />
            </div>
            <button onClick={speakOrder} disabled={!say.trim() || saying}
              className="flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-40"
              style={{ backgroundColor: "var(--accent)", color: "var(--accent-contrast)" }}>
              {saying ? "…" : <><ArrowRight size={13} /> Add</>}
            </button>
          </div>
          {sayNote && <div className="mb-2 text-[11px] text-amber-300">{sayNote}</div>}
          <div className={`grid min-h-0 flex-1 auto-rows-min gap-2 overflow-y-auto pr-1 pb-16 lg:pb-0 ${touch ? "grid-cols-2 sm:grid-cols-2 xl:grid-cols-3" : "grid-cols-2 sm:grid-cols-3 xl:grid-cols-4"}`}>
            {shown.map((m) => {
              const fromPrice = (m.options || []).some((g: any) => (g.choices || []).some((c: any) => c.price != null));
              const inCart = inCartQty[m.id];
              return (
                <button key={m.id} onClick={() => tapItem(m)}
                  style={{ borderTopColor: catColor(cats, m.category), borderTopWidth: 3 }}
                  className="group relative flex flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60 text-left transition hover:border-zinc-500 active:scale-[0.98]">
                  {inCart ? (
                    <span className="absolute right-1.5 top-1.5 z-10 flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-500 px-1 text-[11px] font-bold text-zinc-950">
                      {inCart}
                    </span>
                  ) : null}
                  {m.photo_url ? (
                    <img src={m.photo_url} alt="" className={`${touch ? "h-32" : "h-24"} w-full object-cover transition group-hover:scale-[1.03]`} />
                  ) : (
                    <div className={`flex ${touch ? "h-32" : "h-24"} w-full items-center justify-center bg-zinc-900 text-zinc-700`}><Camera size={18} /></div>
                  )}
                  <div className="flex flex-1 flex-col p-2">
                    <div className="flex items-center gap-1">
                      <span className={`truncate font-medium text-zinc-200 ${touch ? "text-sm" : "text-xs"}`}>{m.name}</span>
                      {m.bestseller ? <Star size={10} className="shrink-0 fill-amber-400 text-amber-400" /> : null}
                    </div>
                    {m.description ? (
                      <div className="mt-0.5 line-clamp-1 text-[10px] text-zinc-500">{m.description}</div>
                    ) : null}
                    <div className="mt-auto flex items-center justify-between pt-1">
                      <span className="text-[11px] tabular-nums text-zinc-400">{fromPrice ? "from " : ""}EGP {money(m.price)}</span>
                      <span className="flex items-center gap-0.5">
                        {m.spice_level ? Array.from({ length: Math.min(3, Number(m.spice_level)) }, (_, i) => (
                          <Flame key={i} size={9} className="text-red-400" />
                        )) : null}
                        {(m.dietary_tags || []).some((t: string) => /veg/i.test(t)) ? <Leaf size={9} className="text-emerald-400" /> : null}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
            {shown.length === 0 && (
              <div className="col-span-full py-10 text-center text-xs text-zinc-600">Nothing matches "{q}"</div>
            )}
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
            {upsell && cart.length > 0 && (
              <div className="rounded-lg border border-dashed border-zinc-700 px-2.5 py-2">
                <div className="mb-1.5 text-[10px] uppercase tracking-wide text-zinc-500">Goes well with {upsell.source}</div>
                <div className="flex flex-wrap gap-1.5">
                  {upsell.items.map((m: any) => (
                    <button key={m.id} onClick={() => { tapItem(m); setUpsell(null); }}
                      className="flex items-center gap-1 rounded-full border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800">
                      <Plus size={10} /> {m.name} · {money(m.price)}
                    </button>
                  ))}
                  <button onClick={() => setUpsell(null)} className="px-1 text-zinc-600 hover:text-zinc-400"><X size={11} /></button>
                </div>
              </div>
            )}
            {cart.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-zinc-600">
                <ShoppingCart size={22} />
                <span className="text-xs">Tap items to build the order</span>
              </div>
            ) : cart.map((l) => (
              <div key={l.uid} className="rounded-lg border border-zinc-800 bg-zinc-900/70 px-2.5 py-2 text-xs">
                <button onClick={() => setConfiguring({ item: l.item, line: l })} className="block w-full text-left">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 font-medium text-zinc-200">
                      {l.item.name}
                      <Pencil size={9} className="text-zinc-600" />
                    </span>
                    <span className="tabular-nums text-zinc-300">{money(l.unit * l.qty)}</span>
                  </div>
                  {Object.entries(l.options).filter(([k]) => k !== "slots").map(([k, v]) => (
                    <div key={k} className="text-[11px] text-zinc-500">{Array.isArray(v) ? v.join(", ") : String(v)}</div>
                  ))}
                  {Array.isArray(l.options.slots) && l.options.slots.map((sl: any, si: number) => (
                    <div key={si} className="text-[11px] text-zinc-500">{si + 1}) {Object.entries(sl || {}).filter(([f]) => f !== "notes").map(([, x]) => x).join(" + ")}{sl?.notes ? ` — ${sl.notes}` : ""}</div>
                  ))}
                  {l.notes && <div className="flex items-center gap-1 text-[11px] text-amber-300"><StickyNote size={10} /> {l.notes}</div>}
                </button>
                <div className="mt-1 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => setCart((c) => c.map((x) => x.uid === l.uid ? { ...x, qty: Math.max(1, x.qty - 1) } : x))}
                      className={`rounded border border-zinc-700 text-zinc-400 ${touch ? "p-2" : "p-0.5"}`}><Minus size={touch ? 14 : 10} /></button>
                    <button onClick={() => setKeypadLine(l)} title="Type the quantity"
                      className={`min-w-6 rounded text-center font-bold tabular-nums hover:bg-zinc-800 ${touch ? "px-2 py-1 text-base" : "px-1"}`}>{l.qty}</button>
                    <button onClick={() => setCart((c) => c.map((x) => x.uid === l.uid ? { ...x, qty: x.qty + 1 } : x))}
                      className={`rounded border border-zinc-700 text-zinc-400 ${touch ? "p-2" : "p-0.5"}`}><Plus size={touch ? 14 : 10} /></button>
                  </div>
                  <button onClick={() => setCart((c) => c.filter((x) => x.uid !== l.uid))} className="text-zinc-600 hover:text-red-400"><Trash2 size={12} /></button>
                </div>
              </div>
            ))}
            {cart.length > 0 && (
              <button onClick={() => setCart([])} className="flex items-center gap-1 pt-1 text-[11px] text-zinc-600 hover:text-red-400">
                <Eraser size={11} /> clear all
              </button>
            )}
          </div>

          <div className="border-t border-zinc-800 p-3 text-xs">
            <div className="space-y-0.5 text-zinc-400">
              <div className="flex justify-between"><span>Subtotal · {itemCount} item{itemCount === 1 ? "" : "s"}</span><span className="tabular-nums">{money(subtotal)}</span></div>
              {disc > 0 && (
                <div className="flex justify-between text-emerald-400">
                  <button onClick={() => setDiscount(null)} title="Remove discount" className="flex items-center gap-1">Discount ({discount?.reason || "—"}) <X size={9} /></button>
                  <span className="tabular-nums">−{money(disc)}</span>
                </div>
              )}
              {service > 0 && <div className="flex justify-between"><span>Service</span><span className="tabular-nums">{money(service)}</span></div>}
              {vat > 0 && <div className="flex justify-between"><span>VAT</span><span className="tabular-nums">{money(vat)}</span></div>}
              {delivery > 0 && <div className="flex justify-between"><span>Delivery</span><span className="tabular-nums">{money(delivery)}</span></div>}
              <div className="flex justify-between pt-1 text-sm font-bold text-zinc-100"><span>TOTAL</span><span className="tabular-nums">EGP {money(total)}</span></div>
              {tip > 0 && <div className="flex justify-between text-amber-300"><button onClick={() => setTip(0)} className="flex items-center gap-1">Tip (not in total) <X size={9} /></button><span className="tabular-nums">{money(tip)}</span></div>}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button onClick={() => setDiscOpen(true)} disabled={!cart.length}
                className="flex items-center gap-1 rounded-lg border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 disabled:opacity-40">
                <BadgePercent size={11} /> Discount
              </button>
              {[10, 20].map((t2) => (
                <button key={t2} onClick={() => setTip((x) => x === t2 ? 0 : t2)}
                  className={`rounded-lg border px-2 py-1 text-[11px] ${tip === t2 ? "border-amber-400/60 text-amber-300" : "border-zinc-700 text-zinc-300"}`}>
                  Tip {t2}
                </button>
              ))}
              <button onClick={() => setSplit(split ? null : [{ method: pay, amount: String(total) }, { method: pay === "cash" ? "card" : "cash", amount: "" }])}
                disabled={!cart.length}
                className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] disabled:opacity-40 ${split ? "border-zinc-400 text-zinc-200" : "border-zinc-700 text-zinc-300"}`}>
                <SplitSquareHorizontal size={11} /> Split
              </button>
            </div>
            {split && (
              <div className="mt-2 space-y-1.5 rounded-lg border border-zinc-800 p-2">
                {split.map((x, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <select value={x.method} onChange={(e) => setSplit((xs) => xs!.map((y, j) => j === i ? { ...y, method: e.target.value } : y))}
                      className="rounded-lg border border-zinc-800 bg-zinc-900 px-1.5 py-1 text-[11px] text-zinc-100">
                      <option value="cash">Cash</option><option value="card">Card</option><option value="instapay">InstaPay</option>
                    </select>
                    <input type="number" value={x.amount} placeholder="EGP"
                      onChange={(e) => setSplit((xs) => xs!.map((y, j) => j === i ? { ...y, amount: e.target.value } : y))}
                      className="w-20 flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-100" />
                    {split.length > 2 && <button onClick={() => setSplit((xs) => xs!.filter((_, j) => j !== i))} className="text-zinc-600"><X size={11} /></button>}
                  </div>
                ))}
                <div className="flex items-center justify-between text-[10px]">
                  <button onClick={() => setSplit((xs) => [...xs!, { method: "cash", amount: "" }])} className="text-zinc-500 hover:text-zinc-300">+ payer</button>
                  <span className={Math.abs(splitSum - total) > 0.5 ? "text-red-400" : "text-emerald-400"}>
                    {money(splitSum)} / {money(total)}
                  </span>
                </div>
              </div>
            )}
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
                {saving ? "Creating…" : createdCode ? `${createdCode} on the board` : `Create · EGP ${money(total)}`}
              </Btn>
            </div>
          </div>
        </div>
      </div>

      {/* tablet/phone: total + create pinned within thumb reach */}
      <div className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-3 border-t border-zinc-800 bg-zinc-950/95 px-4 py-2.5 backdrop-blur lg:hidden">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] text-zinc-500">{itemCount} item{itemCount === 1 ? "" : "s"}</div>
          <div className="truncate text-sm font-bold tabular-nums">EGP {money(total)}</div>
        </div>
        <button onClick={park} disabled={!cart.length} className="rounded-xl border border-zinc-700 p-2.5 text-zinc-300 disabled:opacity-40"><ParkingSquare size={16} /></button>
        <button onClick={create} disabled={!cart.length || saving}
          className="rounded-xl px-5 py-2.5 text-sm font-bold disabled:opacity-40" style={{ backgroundColor: "var(--accent)", color: "var(--accent-contrast)" }}>
          {saving ? "Creating…" : createdCode ? `${createdCode} ✓` : "Create"}
        </button>
      </div>

      {switching && (
        <CashierSwitch cashiers={posCfg.cashiers || []} current={cashier}
          onPick={(n: string) => { setCashier(n); localStorage.setItem("pos_cashier", n); setSwitching(false); }}
          onCancel={() => setSwitching(false)} />
      )}
      {discOpen && (
        <DiscountModal subtotal={subtotal} needsPin={managers.length > 0} managerOk={managerOk}
          onApply={(amount: number, reason: string) => { setDiscount({ amount, reason }); setDiscOpen(false); }}
          onCancel={() => setDiscOpen(false)} />
      )}
      {report && <ShiftReport r={report} onClose={() => setReport(null)} />}
      {keypadLine && (
        <Keypad value={keypadLine.qty}
          onDone={(n) => { setCart((c) => c.map((x) => x.uid === keypadLine.uid ? { ...x, qty: n } : x)); setKeypadLine(null); }}
          onCancel={() => setKeypadLine(null)} />
      )}

      {configuring && (
        <OptionWalker
          item={configuring.item} line={configuring.line} presetQty={(configuring as any).presetQty} menu={menu}
          onCancel={() => setConfiguring(null)} onDone={addLine} touch={touch}
        />
      )}
    </div>
  );
}

const QUICK_NOTES = ["No onion", "No pickles", "Extra sauce", "Well done", "Cut in half"];

// The same questions the bot asks, as taps: format → size → fries → drink,
// or per-slot sandwich picks for bundles. Price updates live; the sandwich's
// own story (photo, description, ingredients) leads so staff can answer
// "what's in it?" without leaving the screen. Tapping a cart line re-opens
// this prefilled to edit in place.
function OptionWalker({ item, line, presetQty, menu, onCancel, onDone, touch }: any) {
  const [pad, setPad] = useState(false);
  const [picked, setPicked] = useState<Record<string, any>>(() => {
    if (!line) return {};
    const { slots: _s, ...rest } = line.options || {};
    return { ...rest };
  });
  const [slots, setSlots] = useState<any[]>(() => {
    if (line && Array.isArray(line.options?.slots)) return line.options.slots.map((x: any) => ({ ...x }));
    const sg = (item.options || []).find((g: any) => g.key === "slots");
    return sg ? Array.from({ length: Number(sg.count) || 2 }, () => ({})) : [];
  });
  const [qty, setQty] = useState(line?.qty || presetQty || 1);
  const [notes, setNotes] = useState(line?.notes || "");
  const slotsGroup = (item.options || []).find((g: any) => g.key === "slots");
  const groups = (item.options || []).filter((g: any) => g.key !== "slots" && groupApplies(g, picked) && groupChoices(g, menu).length);
  const unit = priceOf(item, picked, menu);

  const answered = groups.filter((g: any) => picked[g.key]).length;
  const missing = groups.filter((g: any) => g.required && !picked[g.key]).length +
    (slotsGroup ? slots.filter((sl) => !(slotsGroup.slot_groups || []).filter((sg: any) => !sg.free).every((sg: any) => sl[sg.key])).length : 0);
  const nextGroup = groups.find((g: any) => g.required && !picked[g.key]);

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
  function toggleQuickNote(n: string) {
    setNotes((cur: string) => {
      const parts = cur.split(",").map((x) => x.trim()).filter(Boolean);
      return (parts.includes(n) ? parts.filter((x) => x !== n) : [...parts, n]).join(", ");
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div className="grid max-h-[86vh] w-full max-w-lg grid-rows-[auto_1fr_auto] overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-zinc-800">
          {item.photo_url && <img src={item.photo_url} alt="" className="h-32 w-full object-cover" />}
          <div className="flex items-start justify-between gap-3 px-5 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-sm font-semibold">
                {item.name}
                {item.bestseller ? <Star size={11} className="fill-amber-400 text-amber-400" /> : null}
                {item.spice_level ? Array.from({ length: Math.min(3, Number(item.spice_level)) }, (_, i) => (
                  <Flame key={i} size={10} className="text-red-400" />
                )) : null}
              </div>
              {item.description && <div className="mt-0.5 text-[11px] leading-snug text-zinc-400">{item.description}</div>}
              {item.ingredients && <div className="mt-1 text-[11px] leading-snug text-zinc-500">{item.ingredients}</div>}
            </div>
            <button onClick={onCancel}><X size={16} className="text-zinc-500 hover:text-zinc-200" /></button>
          </div>
          {groups.length > 0 && (
            <div className="flex items-center gap-2 px-5 pb-2.5">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-zinc-800">
                <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${groups.length ? (answered / groups.length) * 100 : 0}%` }} />
              </div>
              <span className="text-[10px] tabular-nums text-zinc-500">{answered}/{groups.length}</span>
            </div>
          )}
        </div>

        <div className="min-h-0 overflow-y-auto p-4">
          {groups.map((g: any) => (
            <div key={g.key} className="mb-4">
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                {g.label || g.key}
                {picked[g.key]
                  ? <Check size={11} className="text-emerald-400" />
                  : nextGroup?.key === g.key ? <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold normal-case tracking-normal text-amber-300">next</span> : null}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {groupChoices(g, menu).map((c: any) => (
                  <button key={c.name} onClick={() => pick(g, c.name)}
                    className={`rounded-lg border transition active:scale-95 ${touch ? "px-3.5 py-2.5 text-sm" : "px-2.5 py-1.5 text-xs"} ${norm(picked[g.key]) === norm(c.name) ? "border-zinc-300 bg-zinc-200 font-semibold text-zinc-900" : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"}`}>
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
                      className={`rounded-lg border px-2 py-1 text-[11px] transition active:scale-95 ${norm(sl[sg.key]) === norm(c.name) ? "border-zinc-300 bg-zinc-200 font-semibold text-zinc-900" : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"}`}>
                      {c.name}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          ))}

          <div className="mb-1.5 flex flex-wrap gap-1.5">
            {QUICK_NOTES.map((n) => {
              const on = notes.split(",").map((x: string) => x.trim()).includes(n);
              return (
                <button key={n} onClick={() => toggleQuickNote(n)}
                  className={`rounded-full border px-2 py-1 text-[10px] transition ${on ? "border-amber-400/60 bg-amber-500/15 text-amber-300" : "border-zinc-800 text-zinc-500 hover:text-zinc-300"}`}>
                  {n}
                </button>
              );
            })}
          </div>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Item notes — no onion, extra sauce…"
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-xs text-zinc-100" />
        </div>

        <div className="flex items-center justify-between border-t border-zinc-800 px-5 py-3">
          <div className="flex items-center gap-2">
            <button onClick={() => setQty((n: number) => Math.max(1, n - 1))} className={`rounded border border-zinc-700 text-zinc-300 ${touch ? "p-2.5" : "p-1"}`}><Minus size={touch ? 15 : 12} /></button>
            <button onClick={() => setPad(true)} title="Type the quantity"
              className={`min-w-7 rounded text-center font-bold tabular-nums hover:bg-zinc-800 ${touch ? "px-2 py-1.5 text-lg" : "px-1 text-sm"}`}>{qty}</button>
            <button onClick={() => setQty((n: number) => n + 1)} className={`rounded border border-zinc-700 text-zinc-300 ${touch ? "p-2.5" : "p-1"}`}><Plus size={touch ? 15 : 12} /></button>
          </div>
          {pad && <Keypad value={qty} onDone={(n) => { setQty(n); setPad(false); }} onCancel={() => setPad(false)} />}
          <Btn
            onClick={() => onDone(item, slotsGroup ? { ...picked, slots } : picked, notes.trim(), qty, line?.uid)}
            className={missing ? "pointer-events-none opacity-50" : ""}
          >
            {missing ? `${missing} choice${missing > 1 ? "s" : ""} left` : line ? `Update · EGP ${money(unit * qty)}` : `Add ${qty} · EGP ${money(unit * qty)}`}
          </Btn>
        </div>
      </div>
    </div>
  );
}

// PIN-gated cashier switch — attribution drives the Z report's per-cashier lines.
// With no cashiers configured in Settings, any name switch is open (pilot mode).
function CashierSwitch({ cashiers, current, onPick, onCancel }: any) {
  const [pin, setPin] = useState("");
  const [pick, setPick] = useState<any | null>(null);
  const [err, setErr] = useState("");
  const free = !cashiers.length;
  const [freeName, setFreeName] = useState("");
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div className="w-72 rounded-2xl border border-zinc-800 bg-zinc-950 p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 text-sm font-semibold">Who's on the register?</div>
        {free ? (
          <div className="space-y-2">
            <input value={freeName} onChange={(e) => setFreeName(e.target.value)} placeholder={current}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-sm text-zinc-100" />
            <p className="text-[11px] text-zinc-600">Add cashiers with PINs in Settings → POS to lock this.</p>
            <Btn onClick={() => onPick((freeName.trim() || current).slice(0, 40))} className="w-full">Switch</Btn>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {cashiers.map((c: any) => (
                <button key={c.name} onClick={() => { setPick(c); setErr(""); }}
                  className={`rounded-lg border px-2.5 py-1.5 text-xs ${pick?.name === c.name ? "border-zinc-300 bg-zinc-200 font-semibold text-zinc-900" : "border-zinc-700 text-zinc-300"}`}>
                  {c.name}{c.manager ? " ★" : ""}
                </button>
              ))}
            </div>
            {pick && (
              <>
                <input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="PIN"
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-center text-lg tracking-[0.5em] text-zinc-100" autoFocus />
                {err && <div className="text-[11px] text-red-400">{err}</div>}
                <Btn className="w-full" onClick={() => {
                  if (String(pick.pin) === pin) onPick(pick.name);
                  else setErr("Wrong PIN");
                }}>Switch to {pick.name}</Btn>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Discount with a reason, manager-PIN-gated when managers exist. The amount is
// computed here for display; the backend recomputes and clamps — code decides.
function DiscountModal({ subtotal, needsPin, managerOk, onApply, onCancel }: any) {
  const [mode, setMode] = useState<"pct" | "egp">("pct");
  const [val, setVal] = useState("");
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const n = Number(val) || 0;
  const amount = Math.round((mode === "pct" ? subtotal * Math.min(n, 100) / 100 : Math.min(n, subtotal)) * 100) / 100;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div className="w-72 rounded-2xl border border-zinc-800 bg-zinc-950 p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 text-sm font-semibold">Discount</div>
        <div className="mb-2 flex gap-1 rounded-full bg-zinc-900 p-1">
          {(["pct", "egp"] as const).map((m2) => (
            <button key={m2} onClick={() => setMode(m2)}
              className={`flex-1 rounded-full px-2 py-1 text-xs ${mode === m2 ? "bg-zinc-700 text-zinc-100" : "text-zinc-500"}`}>
              {m2 === "pct" ? "%" : "EGP"}
            </button>
          ))}
        </div>
        <input type="number" value={val} onChange={(e) => setVal(e.target.value)} placeholder={mode === "pct" ? "10" : "50"}
          className="mb-2 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-sm text-zinc-100" autoFocus />
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason — staff meal, complaint, promo…"
          className="mb-2 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-xs text-zinc-100" />
        {needsPin && (
          <input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="Manager PIN"
            className="mb-2 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-center text-sm tracking-[0.4em] text-zinc-100" />
        )}
        {err && <div className="mb-2 text-[11px] text-red-400">{err}</div>}
        <Btn className="w-full" onClick={() => {
          if (!amount) return setErr("Enter an amount");
          if (!reason.trim()) return setErr("A reason is required — it shows on the Z report");
          if (needsPin && !managerOk(pin)) return setErr("Manager PIN required");
          onApply(amount, reason.trim());
        }}>Apply −EGP {money(amount)}</Btn>
      </div>
    </div>
  );
}

// X report modal — the day's money so far, printable like a ticket
function ShiftReport({ r, onClose }: any) {
  function printIt() {
    const w = window.open("", "_blank", "width=380,height=600");
    if (!w) return;
    const line = (k: string, v: any) => `<div style="display:flex;justify-content:space-between"><span>${k}</span><b>${v}</b></div>`;
    w.document.write(`<pre style="font-family:monospace;font-size:12px;padding:12px">
<b>SHIFT REPORT — ${r.date}${r.branch !== "all" ? ` · ${r.branch}` : ""}</b>
${"-".repeat(32)}
Orders: ${r.orders}   Revenue: EGP ${money(r.revenue)}
VAT: ${money(r.vat)}  Service: ${money(r.service_charge)}
Delivery fees: ${money(r.delivery_fees)}
Discounts: -${money(r.discounts)}  Tips: ${money(r.tips)}
${"-".repeat(32)}
${Object.entries(r.by_method).map(([m2, v]: any) => `${m2.toUpperCase().padEnd(10)} EGP ${money(v)}`).join("\n")}
CASH EXPECTED IN DRAWER: EGP ${money(r.cash_expected)}
${"-".repeat(32)}
${Object.entries(r.by_cashier).map(([c2, v]: any) => `${c2}: ${v.orders} orders · EGP ${money(v.revenue)}${v.discounts ? ` · -${money(v.discounts)} disc` : ""}${v.tips ? ` · ${money(v.tips)} tips` : ""}`).join("\n")}
${r.cancelled.count ? `${"-".repeat(32)}\nCancelled: ${r.cancelled.count} (EGP ${money(r.cancelled.value)})\n${r.cancelled.reasons.map((x: any) => `  ${x.code}: ${x.reason || "no reason"}`).join("\n")}` : ""}
</pre>`);
    w.document.close(); w.print();
  }
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-80 rounded-2xl border border-zinc-800 bg-zinc-950 p-4 text-sm" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <span className="font-semibold">Shift — {r.date}{r.branch !== "all" ? ` · ${r.branch}` : ""}</span>
          <button onClick={onClose}><X size={15} className="text-zinc-500" /></button>
        </div>
        <div className="space-y-1 text-xs text-zinc-300">
          <div className="flex justify-between"><span>Orders</span><b className="tabular-nums">{r.orders}</b></div>
          <div className="flex justify-between"><span>Revenue</span><b className="tabular-nums">EGP {money(r.revenue)}</b></div>
          <div className="flex justify-between text-zinc-500"><span>VAT</span><span className="tabular-nums">{money(r.vat)}</span></div>
          {r.discounts > 0 && <div className="flex justify-between text-emerald-400"><span>Discounts</span><span className="tabular-nums">−{money(r.discounts)}</span></div>}
          {r.tips > 0 && <div className="flex justify-between text-amber-300"><span>Tips</span><span className="tabular-nums">{money(r.tips)}</span></div>}
          <div className="my-2 border-t border-zinc-800" />
          {Object.entries(r.by_method).map(([m2, v]: any) => (
            <div key={m2} className="flex justify-between"><span className="uppercase">{m2}</span><span className="tabular-nums">EGP {money(v)}</span></div>
          ))}
          <div className="flex justify-between font-bold text-zinc-100"><span>Cash in drawer</span><span className="tabular-nums">EGP {money(r.cash_expected)}</span></div>
          <div className="my-2 border-t border-zinc-800" />
          {Object.entries(r.by_cashier).map(([c2, v]: any) => (
            <div key={c2} className="flex justify-between"><span>{c2}</span><span className="tabular-nums">{v.orders} · EGP {money(v.revenue)}</span></div>
          ))}
          {r.cancelled.count > 0 && (
            <div className="flex justify-between text-red-400"><span>Cancelled</span><span className="tabular-nums">{r.cancelled.count} · EGP {money(r.cancelled.value)}</span></div>
          )}
        </div>
        <Btn className="mt-3 w-full" onClick={printIt}>Print</Btn>
      </div>
    </div>
  );
}
