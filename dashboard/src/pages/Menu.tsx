import { useEffect, useMemo, useRef, useState } from "react";
import {
  Plus, Star, Camera, Settings2, Pencil, Search, FileText, Sparkles,
  AlertTriangle, Clock, Flame, GripVertical, TrendingUp, X, Leaf, WheatOff, Copy, BarChart3,
} from "lucide-react";
import { api } from "../config/api";
import { Card, PageHeader, Btn, Input, Empty, ArmButton } from "../components/ui";
import OptionsEditor from "./OptionsEditor";

const TAG_ICON: Record<string, any> = { vegan: Leaf, vegetarian: Leaf, gf: WheatOff };

// the PDF endpoint resolves the restaurant from ?r= — without it, a multi-restaurant
// deployment has no way to know whose menu to render
const PDF_BASE = "https://flows.munadim.com/pdf/menu";

import { money } from "../lib/format";

const todayISO = () => new Date().toLocaleDateString("en-CA");
const soldOutToday = (item: any) => item.sold_out_until && String(item.sold_out_until).slice(0, 10) >= todayISO();
const hasSamplePrice = (item: any) =>
  (item.options || []).some((g: any) => g.sample || (g.choices || []).some((c: any) => c.sample));

export default function Menu() {
  const [items, setItems] = useState<any[]>([]);
  const [perf, setPerf] = useState<Record<string, { units: number; egp: number }>>({});
  const [showNew, setShowNew] = useState(false);
  const [eng, setEng] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [optId, setOptId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [bySales, setBySales] = useState(false);
  const [tidy, setTidy] = useState<any[] | null>(null);
  const [slug, setSlug] = useState("");
  const [tidying, setTidying] = useState(false);
  const dragId = useRef<string | null>(null);

  const load = () => api.get("/api/menu").then((r) => setItems(r.data)).catch(() => {});
  useEffect(() => {
    load();
    api.get("/api/menu/performance").then((r) => setPerf(r.data || {})).catch(() => {});
    api.get("/api/settings").then((r) => setSlug(r.data?.slug || "")).catch(() => {});
  }, []);

  async function uploadPhoto(item: any, file?: File) {
    if (!file) return;
    const fd = new FormData();
    fd.append("photo", file);
    try {
      await api.post(`/api/menu/${item.id}/photo`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      load();
    } catch (e: any) {
      alert(e.response?.data?.error || "Upload failed");
    }
  }

  async function patch(item: any, body: any) {
    setItems((xs) => xs.map((x) => (x.id === item.id ? { ...x, ...body } : x)));
    await api.patch(`/api/menu/${item.id}`, body).catch(() => { load(); });
  }

  // one-tap duplicate: full copy incl. options and details, ready to rename
  async function duplicate(item: any) {
    const { data: created } = await api.post("/api/menu", {
      name: `${item.name} (copy)`, category: item.category,
      price: Number(item.price), description: item.description || null,
      sort_order: (Number(item.sort_order) || 0) + 1,
    });
    if (created?.id) {
      await api.patch(`/api/menu/${created.id}`, {
        options: item.options || null, ingredients: item.ingredients || null,
        spice_level: item.spice_level ?? null, pairs_with: item.pairs_with || null,
        dietary_tags: item.dietary_tags || [], available: false, // starts hidden until renamed
      }).catch(() => {});
    }
    load();
  }

  // drag-to-reorder within a category — the order drives the PDF and how the bot lists
  async function onDrop(target: any) {
    const src = items.find((i) => i.id === dragId.current);
    dragId.current = null;
    if (!src || !target || src.id === target.id || src.category !== target.category) return;
    const cat = items.filter((i) => i.category === src.category);
    const without = cat.filter((i) => i.id !== src.id);
    const at = without.findIndex((i) => i.id === target.id);
    without.splice(at, 0, src);
    const base = Math.min(...cat.map((i) => Number(i.sort_order) || 0));
    const updates = without.map((i, idx) => ({ id: i.id, sort_order: base + idx }));
    setItems((xs) => xs.map((x) => {
      const u = updates.find((u2) => u2.id === x.id);
      return u ? { ...x, sort_order: u.sort_order } : x;
    }).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)));
    for (const u of updates) await api.patch(`/api/menu/${u.id}`, { sort_order: u.sort_order }).catch(() => {});
  }

  async function runTidy() {
    setTidying(true);
    try {
      const { data } = await api.post("/api/menu/tidy");
      setTidy(data?.fixes || []);
    } catch { alert("Tidy failed — flows may be busy"); }
    setTidying(false);
  }

  const filtered = useMemo(() => {
    let out = items;
    if (q.trim()) {
      const n = q.trim().toLowerCase();
      out = out.filter((i) => i.name.toLowerCase().includes(n) || (i.description || "").toLowerCase().includes(n));
    }
    return out;
  }, [items, q]);

  const categories = [...new Set(filtered.map((i) => i.category))];
  const off = items.filter((i) => !i.available).length;
  const sampleCount = items.filter(hasSamplePrice).length;

  const catItems = (cat: string) => {
    let list = filtered.filter((i) => i.category === cat);
    if (bySales) list = [...list].sort((a, b) => (perf[b.name]?.units || 0) - (perf[a.name]?.units || 0));
    return list;
  };

  return (
    <div>
      <PageHeader
        title="Menu"
        subtitle={`${items.length} items${off ? ` · ${off} off the menu` : ""}${sampleCount ? ` · ${sampleCount} with unverified prices` : ""}`}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => setEng((x) => !x)} title="Menu engineering — profitability × popularity quadrants"
              className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs ${eng ? "border-zinc-400 text-zinc-200" : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"}`}>
              <BarChart3 size={13} /> Engineering
            </button>
            <a href={slug ? `${PDF_BASE}?r=${encodeURIComponent(slug)}` : PDF_BASE} target="_blank" rel="noreferrer" title="Preview the menu PDF guests receive — it regenerates automatically after edits"
              className="flex items-center gap-1.5 rounded-xl border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800">
              <FileText size={13} /> PDF
            </a>
            <button onClick={runTidy} disabled={tidying} title="AI proposes copy fixes (typos, truncations) — you approve each one"
              className="flex items-center gap-1.5 rounded-xl border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50">
              <Sparkles size={13} /> {tidying ? "checking…" : "Tidy descriptions"}
            </button>
            <Btn onClick={() => setShowNew((v) => !v)}><span className="flex items-center gap-1.5"><Plus size={15} /> New item</span></Btn>
          </div>
        }
      />

      {/* sticky nav: search + category jumps + sales sort */}
      <div className="sticky top-0 z-20 -mx-2 mb-5 flex flex-wrap items-center gap-2 bg-zinc-950/95 px-2 py-2 backdrop-blur">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search items…"
            className="w-44 rounded-lg border border-zinc-800 bg-zinc-900 py-1.5 pl-8 pr-2 text-xs text-zinc-100 outline-none focus:border-zinc-600" />
        </div>
        {[...new Set(items.map((i) => i.category))].map((c) => (
          <button key={c} onClick={() => document.getElementById(`cat-${c}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
            className="rounded-full bg-zinc-800/70 px-2.5 py-1 text-[11px] text-zinc-400 transition hover:text-zinc-100">
            {c}
          </button>
        ))}
        <button onClick={() => setBySales(!bySales)}
          className={`ml-auto flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] transition ${bySales ? "bg-zinc-200 font-semibold text-zinc-900" : "bg-zinc-800/70 text-zinc-400 hover:text-zinc-200"}`}>
          <TrendingUp size={11} /> by sales (30d)
        </button>
      </div>

      {tidy && <TidyModal fixes={tidy} onClose={() => setTidy(null)} onApplied={load} />}

      {showNew && <NewItemModal items={items} onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load(); }} />}

      {items.length === 0 ? (
        <Card><Empty text="No menu items" /></Card>
      ) : (
        categories.map((cat) => {
          const list = catItems(cat);
          const allOn = list.every((i) => i.available);
          return (
            <div key={cat} id={`cat-${cat}`} className="mb-8 scroll-mt-16">
              {eng && <EngineeringPanel items={items} perf={perf} />}

      <div className="mb-3 flex items-center gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-400">{cat}</h2>
                <button
                  onClick={() => list.forEach((i) => i.available === allOn && patch(i, { available: !allOn }))}
                  className="text-[11px] text-zinc-500 underline decoration-dotted underline-offset-2 hover:text-zinc-300"
                  title={allOn ? "Take the whole category off the menu" : "Bring the whole category back"}
                >
                  {allOn ? "turn all off" : "turn all on"}
                </button>
              </div>
              <div className="space-y-2">
                {list.map((item) => (
                  <MenuRow
                    key={item.id}
                    item={item}
                    perf={perf[item.name]}
                    editId={editId} optId={optId}
                    setEditId={setEditId} setOptId={setOptId}
                    categories={categories}
                    patch={patch}
                    uploadPhoto={uploadPhoto}
                    load={load}
                    dragId={dragId}
                    onDrop={onDrop}
                    onDuplicate={duplicate}
                  />
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

function MenuRow({ item, perf, editId, optId, setEditId, setOptId, categories, patch, uploadPhoto, load, dragId, onDrop, onDuplicate }: any) {
  const [priceEdit, setPriceEdit] = useState(false);
  const [priceVal, setPriceVal] = useState(String(item.price));
  const sold = soldOutToday(item);
  const sample = hasSamplePrice(item);

  return (
    <div
      draggable
      onDragStart={() => { dragId.current = item.id; }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={() => onDrop(item)}
    >
    <Card className={`px-4 py-3 ${item.available ? "" : "opacity-50"} ${sold ? "border-amber-500/40" : ""}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <GripVertical size={14} className="shrink-0 cursor-grab text-zinc-700" />
          <label className="group relative h-12 w-12 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900" title="Upload photo — the bot sends it to guests">
            {item.photo_url ? (
              <img src={item.photo_url} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-amber-500/70" title="No photo — the bot can't show this dish"><Camera size={16} /></span>
            )}
            <span className="absolute inset-0 hidden items-center justify-center bg-black/60 text-[10px] text-white group-hover:flex">upload</span>
            <input type="file" accept="image/*" className="hidden" onChange={(e) => uploadPhoto(item, e.target.files?.[0])} />
          </label>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
              <span className="truncate">{item.name}</span>
              {(item.dietary_tags || []).map((t: string) => {
                const T = TAG_ICON[t];
                return T ? <T key={t} size={12} className="text-emerald-400" /> : null;
              })}
              {item.spice_level > 0 && Array.from({ length: item.spice_level }).map((_, i) => <Flame key={i} size={11} className="text-red-400" />)}
              <button
                title={item.bestseller ? "Bestseller — click to unmark" : "Mark as bestseller (shows on the PDF)"}
                onClick={() => patch(item, { bestseller: !item.bestseller })}
              >
                <Star size={13} className={item.bestseller ? "fill-amber-400 text-amber-400" : "text-zinc-700 hover:text-zinc-500"} />
              </button>
              {sample && (
                <span className="flex items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300" title="Some option prices were estimated — verify them in options">
                  <AlertTriangle size={10} /> verify price
                </span>
              )}
              {sold && (
                <span className="flex items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
                  <Clock size={10} /> sold out today
                </span>
              )}
            </div>
            {item.description && <div className="truncate text-xs text-zinc-500">{item.description}</div>}
            {perf && perf.units > 0 && (
              <div className="text-[10px] text-zinc-600">{perf.units} sold · EGP {money(Math.round(perf.egp))} (30d)</div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {/* click the price to edit it in place */}
          {priceEdit ? (
            <form onSubmit={(e) => { e.preventDefault(); patch(item, { price: Number(priceVal) }); setPriceEdit(false); }}>
              <input
                autoFocus type="number" step="any" value={priceVal}
                onChange={(e) => setPriceVal(e.target.value)}
                onBlur={() => setPriceEdit(false)}
                className="w-20 rounded-lg border border-zinc-600 bg-zinc-900 px-2 py-1 text-right text-sm text-zinc-100 outline-none"
              />
            </form>
          ) : (
            <button onClick={() => { setPriceVal(String(item.price)); setPriceEdit(true); }} title="Click to edit the price"
              className="text-sm font-semibold tabular-nums hover:text-amber-300">
              {(item.options || []).some((g: any) => (g.choices || []).some((c: any) => c.price != null)) ? "from " : ""}EGP {money(item.price)}
            </button>
          )}
          <button
            onClick={() => setOptId(optId === item.id ? null : item.id)}
            className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-xs ${
              sample ? "border-amber-500/60 text-amber-300 hover:bg-amber-500/10"
              : (item.options || []).length ? "border-zinc-700 text-zinc-300 hover:bg-zinc-800"
              : "border-zinc-800 text-zinc-500 hover:bg-zinc-800"
            }`}
            title={(item.options || []).length ? "Questions the bot asks before this item can be ordered" : "No option questions configured"}
          >
            <Settings2 size={12} /> options{(item.options || []).length ? ` (${item.options.length})` : ""}
          </button>
          <button
            onClick={() => setEditId(editId === item.id ? null : item.id)}
            className="flex items-center gap-1 rounded-lg border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800"
            title="Dish details the bot uses to answer questions"
          >
            <Pencil size={12} /> details
          </button>
          <button title="Duplicate this item (copies questions & details; starts hidden)"
            onClick={() => onDuplicate(item)}
            className="rounded-lg border border-zinc-800 px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-800">
            <Copy size={12} />
          </button>
          <button
            title={sold ? "Back in stock — remove today's 86" : "Sold out today — auto-returns tomorrow, bot says so honestly"}
            onClick={() => patch(item, { sold_out_until: sold ? null : todayISO() })}
            className={`rounded-lg border px-2 py-1 text-xs ${sold ? "border-amber-500/60 text-amber-300" : "border-zinc-800 text-zinc-500 hover:bg-zinc-800"}`}
          >
            <Clock size={12} />
          </button>
          <button
            onClick={() => patch(item, { available: !item.available })}
            className={`relative h-6 w-11 rounded-full transition ${item.available ? "bg-emerald-500" : "bg-zinc-700"}`}
            title={item.available ? "On the menu — click to remove entirely" : "Off the menu — click to restore"}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${item.available ? "left-[22px]" : "left-0.5"}`} />
          </button>
        </div>
      </div>
      {editId === item.id && (
        <DetailsEditor item={item} onSaved={() => { setEditId(null); load(); }} />
      )}
      {optId === item.id && (
        <OptionsEditor item={item} categories={categories} onSaved={() => { setOptId(null); load(); }} />
      )}
    </Card>
    </div>
  );
}

// AI-proposed copy fixes — nothing applies without a human tap
function TidyModal({ fixes, onClose, onApplied }: { fixes: any[]; onClose: () => void; onApplied: () => void }) {
  const [left, setLeft] = useState(fixes);
  async function apply(f: any) {
    await api.patch(`/api/menu/${f.id}`, { description: f.after }).catch(() => {});
    setLeft((xs) => xs.filter((x) => x.id !== f.id));
    onApplied();
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-950 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><Sparkles size={14} /> Proposed copy fixes ({left.length})</h2>
          <button onClick={onClose}><X size={16} className="text-zinc-500 hover:text-zinc-200" /></button>
        </div>
        {left.length === 0 ? (
          <div className="py-8 text-center text-sm text-zinc-500">Descriptions look clean.</div>
        ) : (
          <>
            <div className="space-y-3">
              {left.map((f) => (
                <div key={f.id} className="rounded-xl border border-zinc-800 p-3 text-xs">
                  <div className="mb-1 font-semibold text-zinc-200">{f.name}</div>
                  <div className="text-red-400/80 line-through">{f.before || "(empty)"}</div>
                  <div className="mt-0.5 text-emerald-300">{f.after}</div>
                  <button onClick={() => apply(f)} className="mt-2 rounded-lg bg-zinc-100 px-3 py-1 text-[11px] font-semibold text-zinc-900">Apply</button>
                </div>
              ))}
            </div>
            <button onClick={async () => { for (const f of [...left]) await apply(f); }}
              className="mt-4 rounded-xl border border-zinc-700 px-4 py-2 text-xs font-semibold text-zinc-200 hover:bg-zinc-800">
              Apply all
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// Full edit parity with adding: everything about the dish in one place —
// name, category, price, description, ingredients, spice, pairing, dietary
// tags — plus delete. Options stay in the dedicated options editor.
function DetailsEditor({ item, onSaved }: { item: any; onSaved: () => void }) {
  const [f, setF] = useState({
    name: item.name || "",
    name_ar: item.name_ar || "",
    category: item.category || "",
    price: String(item.price ?? ""),
    ingredients: item.ingredients || "",
    spice_level: item.spice_level ?? "",
    pairs_with: item.pairs_with || "",
    description: item.description || "",
    dietary_tags: (item.dietary_tags || []) as string[],
    stock_count: item.stock_count == null ? "" : String(item.stock_count),
    cost: item.cost == null ? "" : String(item.cost),
  });
  const TAGS = ["vegetarian", "vegan", "gf", "spicy"];
  return (
    <div className="mt-3 border-t border-zinc-800 pt-3">
      <div className="grid gap-2 md:grid-cols-3">
        <Input placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Input placeholder="الاسم بالعربي (POS Arabic mode)" dir="rtl" value={f.name_ar} onChange={(e) => setF({ ...f, name_ar: e.target.value })} />
        <Input placeholder="Category" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />
        <Input type="number" step="any" placeholder="Price" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
        <Input className="md:col-span-3" placeholder="Description — what's in it, how it's made" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        <Input className="md:col-span-2" placeholder="Ingredients (comma-sep — the bot answers from these)" value={f.ingredients} onChange={(e) => setF({ ...f, ingredients: e.target.value })} />
        <Input placeholder="Pairs well with…" value={f.pairs_with} onChange={(e) => setF({ ...f, pairs_with: e.target.value })} />
        <Input type="number" placeholder="Stock today (empty = untracked; 0 = sold out)" title="Counts down with every sale; at 0 the item 86es itself for the POS and the bot"
          value={f.stock_count} onChange={(e) => setF({ ...f, stock_count: e.target.value })} />
        <Input type="number" step="any" placeholder="Cost to make (EGP — for margin reports)" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
          value={String(f.spice_level)}
          onChange={(e) => setF({ ...f, spice_level: e.target.value })}
        >
          <option value="">Spice: unknown</option>
          <option value="0">Spice: none</option>
          <option value="1">Spice: mild</option>
          <option value="2">Spice: medium</option>
          <option value="3">Spice: hot</option>
        </select>
        {TAGS.map((t) => (
          <button key={t} type="button"
            onClick={() => setF({ ...f, dietary_tags: f.dietary_tags.includes(t) ? f.dietary_tags.filter((x) => x !== t) : [...f.dietary_tags, t] })}
            className={`rounded-full px-2.5 py-1 text-[11px] ${f.dietary_tags.includes(t) ? "bg-emerald-500/20 text-emerald-300" : "bg-zinc-800/70 text-zinc-500"}`}>
            {t}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <ArmButton
            armedLabel="Sure? The bot stops knowing it exists"
            onConfirm={async () => {
              await api.delete(`/api/menu/${item.id}`).catch((e: any) => alert(e.response?.data?.error || "Delete failed"));
              onSaved();
            }}
            className="flex items-center gap-1 rounded-xl border border-red-500/40 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10"
          >
            <X size={12} /> Delete item
          </ArmButton>
          <Btn
            className="px-4 py-1.5 text-xs"
            onClick={async () => {
              await api.patch(`/api/menu/${item.id}`, {
                name: f.name.trim() || item.name,
                name_ar: f.name_ar.trim() || null,
                category: f.category.trim() || item.category,
                price: f.price === "" ? item.price : Number(f.price),
                description: f.description.trim() || null,
                ingredients: f.ingredients.trim() || null,
                spice_level: f.spice_level === "" ? null : Number(f.spice_level),
                pairs_with: f.pairs_with.trim() || null,
                dietary_tags: f.dietary_tags,
                stock_count: f.stock_count === "" ? null : Math.max(0, Number(f.stock_count)),
                cost: f.cost === "" ? null : Number(f.cost),
              });
              onSaved();
            }}
          >
            Save
          </Btn>
        </div>
      </div>
    </div>
  );
}
// ---------- the item builder: everything in one place, prefilled from the menu ----------
// Kind decides the shape: a simple item, a meal with combo questions (sizes,
// fries, drinks — cloned from your existing meals, editable inline), or a
// bundle composed by picking which sandwiches guests may choose.

const DIETARY = ["vegetarian", "vegan", "gf", "spicy"];

function deepCopy<T>(v: T): T { return JSON.parse(JSON.stringify(v)); }

function NewItemModal({ items, onClose, onCreated }: { items: any[]; onClose: () => void; onCreated: () => void }) {
  const [kind, setKind] = useState<"simple" | "meal" | "bundle">("simple");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [price, setPrice] = useState("");
  const [description, setDescription] = useState("");
  const [ingredients, setIngredients] = useState("");
  const [spice, setSpice] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [bestseller, setBestseller] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  // meal template: cloned from your most complete existing meal, renamed to this item
  const mealSrc = items.find((i) => (i.options || []).some((g: any) => g.key === "format"));
  const [groups, setGroups] = useState<any[]>([]);
  // template loads ONCE per kind/source — renaming the item must never wipe the
  // user's choice edits; the base→name substitution happens at create time
  useEffect(() => {
    if (kind !== "meal") return;
    setGroups(mealSrc ? deepCopy(mealSrc.options) : []);
  }, [kind, mealSrc?.id]);

  // bundle: pick the sandwiches guests can choose between
  const bundleSrc = items.find((i) => (i.options || []).some((g: any) => g.key === "slots"));
  const sandwichPool: string[] = bundleSrc
    ? (bundleSrc.options.find((g: any) => g.key === "slots")?.slot_groups?.find((sg: any) => sg.key === "sandwich")?.choices || []).map((c: any) => c.name)
    : [...new Set(items.filter((i) => /meal|sandwich|wrap|burger/i.test(i.name)).map((i) => i.name.replace(/\s+Meal$/i, "")))];
  const [slotCount, setSlotCount] = useState(4);
  const [picked, setPicked] = useState<string[]>(sandwichPool);
  const [withNotes, setWithNotes] = useState(true);

  function updateChoice(gi: number, ci: number, field: string, value: any) {
    setGroups((gs) => gs.map((g, i) => i !== gi ? g : {
      ...g, choices: g.choices.map((c: any, j: number) => j !== ci ? c : { ...c, [field]: value === "" || value === null ? undefined : value }),
    }));
  }
  function removeChoice(gi: number, ci: number) {
    setGroups((gs) => gs.map((g, i) => i !== gi ? g : { ...g, choices: g.choices.filter((_: any, j: number) => j !== ci) }));
  }
  function addChoice(gi: number) {
    setGroups((gs) => gs.map((g, i) => i !== gi ? g : { ...g, choices: [...g.choices, { name: "" }] }));
  }

  function buildOptions(): any[] | null {
    if (kind === "meal") {
      const base = (mealSrc?.name || "").replace(/\s+Meal$/i, "");
      const mine = (name || "New item").replace(/\s+Meal$/i, "");
      const sub = (v: string) => (base ? String(v).split(base).join(mine) : String(v));
      return groups.map((g) => ({
        ...g,
        when: g.when?.format ? { format: g.when.format.map(sub) } : g.when,
        choices: (g.choices || []).filter((c: any) => String(c.name).trim()).map((c: any) => ({ ...c, name: sub(c.name) })),
      })).filter((g) => (g.choices || []).length);
    }
    if (kind === "bundle") {
      const slot_groups: any[] = [{ key: "sandwich", label: "Sandwich", choices: picked.map((n) => ({ name: n })) }];
      if (withNotes) slot_groups.push({ key: "notes", label: "Notes", free: true });
      return [{ key: "slots", count: slotCount, label: `Your ${slotCount} sandwiches`, required: true, slot_groups }];
    }
    return null;
  }

  async function create() {
    if (!name.trim() || !price || saving) return;
    setSaving(true);
    try {
      const { data: created } = await api.post("/api/menu", {
        name: name.trim(), category: category.trim() || "Mains", price: Number(price),
        description: description.trim() || null,
        sort_order: Math.max(0, ...items.filter((i) => i.category === category).map((i) => Number(i.sort_order) || 0)) + 1,
      });
      const options = buildOptions();
      await api.patch(`/api/menu/${created.id}`, {
        ...(options ? { options } : {}),
        ingredients: ingredients.trim() || null,
        spice_level: spice === "" ? null : Number(spice),
        dietary_tags: tags,
        bestseller,
      }).catch(() => {});
      if (photo) {
        const fd = new FormData();
        fd.append("photo", photo);
        await api.post(`/api/menu/${created.id}/photo`, fd, { headers: { "Content-Type": "multipart/form-data" } }).catch(() => {});
      }
      onCreated();
    } catch (e: any) {
      alert(e.response?.data?.error || "Failed to create the item");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="grid max-h-[88vh] w-full max-w-2xl grid-rows-[auto_1fr_auto] overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
          <div className="text-sm font-semibold">New menu item</div>
          <button onClick={onClose}><X size={16} className="text-zinc-500 hover:text-zinc-200" /></button>
        </div>

        <div className="min-h-0 overflow-y-auto p-5">
          {/* what kind of item — this decides which questions the bot will ask */}
          <div className="mb-4 flex gap-1">
            {([["simple", "Simple item"], ["meal", "Meal / combo"], ["bundle", "Bundle"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setKind(k)}
                className={`flex-1 rounded-lg px-2 py-2 text-xs font-medium ${kind === k ? "bg-zinc-200 text-zinc-900" : "bg-zinc-800/70 text-zinc-400"}`}>
                {l}
              </button>
            ))}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <Input placeholder="Name * (e.g. Smoky BBQ Meal)" value={name} onChange={(e) => setName(e.target.value)} />
            <div>
              <Input list="nb-cats" placeholder="Category *" value={category} onChange={(e) => setCategory(e.target.value)} />
              <datalist id="nb-cats">{[...new Set(items.map((i) => i.category))].map((c) => <option key={c} value={c} />)}</datalist>
            </div>
            <Input type="number" step="any" placeholder={kind === "meal" ? "Base price * (sandwich-only)" : "Price *"} value={price} onChange={(e) => setPrice(e.target.value)} />
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-zinc-700 px-3 py-2 text-xs text-zinc-400 hover:border-zinc-500">
              <Camera size={14} />
              {photo ? photo.name : "Photo (the bot sends it to guests)"}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => setPhoto(e.target.files?.[0] || null)} />
            </label>
            <Input className="md:col-span-2" placeholder="Description — what's in it, how it's made" value={description} onChange={(e) => setDescription(e.target.value)} />
            <Input placeholder="Ingredients (comma-sep — the bot answers from these)" value={ingredients} onChange={(e) => setIngredients(e.target.value)} />
            <div className="flex items-center gap-3">
              <select value={spice} onChange={(e) => setSpice(e.target.value)}
                className="rounded-xl border border-zinc-700 bg-zinc-900 px-2 py-2 text-xs text-zinc-200">
                <option value="">Spice: unknown</option>
                <option value="0">Spice: none</option>
                <option value="1">Spice: mild</option>
                <option value="2">Spice: medium</option>
                <option value="3">Spice: hot</option>
              </select>
              <label className="flex items-center gap-1.5 text-xs text-zinc-300">
                <input type="checkbox" checked={bestseller} onChange={(e) => setBestseller(e.target.checked)} />
                <Star size={12} className={bestseller ? "fill-amber-400 text-amber-400" : "text-zinc-500"} /> bestseller
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2 md:col-span-2">
              {DIETARY.map((t) => (
                <button key={t} onClick={() => setTags((xs) => xs.includes(t) ? xs.filter((x) => x !== t) : [...xs, t])}
                  className={`rounded-full px-2.5 py-1 text-[11px] ${tags.includes(t) ? "bg-emerald-500/20 text-emerald-300" : "bg-zinc-800/70 text-zinc-500"}`}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          {kind === "meal" && (
            <div className="mt-5">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                Combo questions <span className="font-normal normal-case text-zinc-500">— prefilled from your menu; edit anything</span>
              </div>
              {!mealSrc ? (
                <div className="text-xs text-zinc-500">No existing meal to copy the structure from — create one item with options first, or start simple and add options later.</div>
              ) : groups.map((g, gi) => (
                <div key={g.key} className="mb-3 rounded-xl border border-zinc-800 p-3">
                  <div className="mb-2 text-xs font-semibold text-zinc-300">{g.label}{g.when ? <span className="ml-1 font-normal text-zinc-500">(only if {Object.values(g.when).flat().join("/")})</span> : null}</div>
                  <div className="space-y-1.5">
                    {(g.choices || []).map((c: any, ci: number) => (
                      <div key={ci} className="flex items-center gap-2">
                        <input value={c.name} placeholder="choice name"
                          onChange={(e) => updateChoice(gi, ci, "name", e.target.value)}
                          className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-100" />
                        <input type="number" step="any" placeholder={g.key === "format" ? "price" : "+EGP"}
                          value={g.key === "format" ? (c.price ?? "") : (c.delta ?? "")}
                          onChange={(e) => updateChoice(gi, ci, g.key === "format" ? "price" : "delta", e.target.value === "" ? "" : Number(e.target.value))}
                          className="w-20 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1 text-right text-xs text-zinc-100" />
                        <button onClick={() => removeChoice(gi, ci)} className="text-zinc-600 hover:text-red-400"><X size={12} /></button>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => addChoice(gi)} className="mt-1.5 text-[11px] text-zinc-500 underline decoration-dotted hover:text-zinc-300">+ add choice</button>
                </div>
              ))}
            </div>
          )}

          {kind === "bundle" && (
            <div className="mt-5">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Bundle contents</div>
              <div className="mb-3 flex items-center gap-2 text-xs text-zinc-300">
                Guests pick
                <select value={slotCount} onChange={(e) => setSlotCount(Number(e.target.value))}
                  className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100">
                  {[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                sandwiches, one at a time, with
                <label className="flex items-center gap-1"><input type="checkbox" checked={withNotes} onChange={(e) => setWithNotes(e.target.checked)} /> per-sandwich notes</label>
              </div>
              <div className="grid grid-cols-2 gap-1.5 md:grid-cols-3">
                {sandwichPool.map((s) => (
                  <button key={s} onClick={() => setPicked((xs) => xs.includes(s) ? xs.filter((x) => x !== s) : [...xs, s])}
                    className={`rounded-lg border px-2 py-1.5 text-left text-xs ${picked.includes(s) ? "border-emerald-500/50 bg-emerald-500/10 text-zinc-100" : "border-zinc-800 text-zinc-500"}`}>
                    {s}
                  </button>
                ))}
              </div>
              <div className="mt-1.5 text-[11px] text-zinc-500">The bot sends a copy-paste template (FIRST CHOICE / SANDWICH / NOTES …) sized to {slotCount} and only accepts the sandwiches selected above.</div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-zinc-800 px-5 py-3">
          <div className="text-[11px] text-zinc-500">
            {kind === "meal" ? "Prices you leave from the template stay flagged amber until verified." : kind === "bundle" ? `${picked.length} sandwiches selectable.` : ""}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-xl border border-zinc-700 px-4 py-2 text-xs text-zinc-300">Cancel</button>
            <Btn onClick={create} className={name.trim() && price ? "" : "pointer-events-none opacity-50"}>
              {saving ? "Creating…" : "Create item"}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}


// Menu engineering: popularity (units sold) × margin (price − cost) quadrants.
// Stars = keep and push · Plow-horses = popular but thin, re-price or re-cost ·
// Puzzles = profitable but unknown, promote · Dogs = neither, candidates to cut.
function EngineeringPanel({ items, perf }: any) {
  const rows = items
    .map((m: any) => ({
      name: m.name,
      units: perf[m.name]?.units || 0,
      margin: m.cost != null ? Number(m.price) - Number(m.cost) : null,
    }));
  const withCost = rows.filter((r: any) => r.margin != null);
  const med = (xs: number[]) => { const a = [...xs].sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : 0; };
  const mUnits = med(rows.map((r: any) => r.units));
  const mMargin = med(withCost.map((r: any) => r.margin));
  const Q = (hot: boolean, rich: boolean) => withCost.filter((r: any) => (r.units >= mUnits) === hot && (r.margin >= mMargin) === rich)
    .sort((a: any, b: any) => b.units - a.units);
  const quads = [
    { label: "Stars — keep & push", tone: "text-emerald-300", list: Q(true, true) },
    { label: "Plow-horses — popular, thin margin", tone: "text-amber-300", list: Q(true, false) },
    { label: "Puzzles — profitable, unknown", tone: "text-sky-300", list: Q(false, true) },
    { label: "Dogs — consider cutting", tone: "text-red-400", list: Q(false, false) },
  ];
  return (
    <Card className="mb-4 p-5">
      <div className="mb-1 text-sm font-semibold text-zinc-200">Menu engineering — units sold × margin</div>
      {withCost.length === 0 ? (
        <p className="text-xs text-zinc-500">Add a "cost to make" on your items (edit an item → Cost field) and this fills in — margins need real costs, never guesses.</p>
      ) : (
        <>
          {rows.length > withCost.length && (
            <p className="mb-2 text-[11px] text-zinc-500">{rows.length - withCost.length} item{rows.length - withCost.length > 1 ? "s" : ""} missing a cost — excluded.</p>
          )}
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            {quads.map((q) => (
              <div key={q.label} className="rounded-xl border border-zinc-800 p-3">
                <div className={`mb-1.5 text-[11px] font-semibold ${q.tone}`}>{q.label} · {q.list.length}</div>
                {q.list.slice(0, 5).map((r: any) => (
                  <div key={r.name} className="flex justify-between text-[11px] text-zinc-400">
                    <span className="truncate pr-1">{r.name}</span>
                    <span className="shrink-0 tabular-nums">{r.units}u · {Math.round(r.margin)} EGP</span>
                  </div>
                ))}
                {q.list.length === 0 && <div className="text-[11px] text-zinc-700">—</div>}
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
