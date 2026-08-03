import { useEffect, useMemo, useRef, useState } from "react";
import {
  Plus, Star, Camera, Settings2, Pencil, Search, FileText, Sparkles,
  AlertTriangle, Clock, Flame, GripVertical, TrendingUp, X, Leaf, WheatOff, Copy,
} from "lucide-react";
import { api } from "../config/api";
import { Card, PageHeader, Btn, Input, Empty } from "../components/ui";
import OptionsEditor from "./OptionsEditor";

const TAG_ICON: Record<string, any> = { vegan: Leaf, vegetarian: Leaf, gf: WheatOff };

const PDF_URL = "https://ahlan-resto.vercel.app/menu.pdf";

function money(n: any) {
  const v = Number(n || 0);
  return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const todayISO = () => new Date().toLocaleDateString("en-CA");
const soldOutToday = (item: any) => item.sold_out_until && String(item.sold_out_until).slice(0, 10) >= todayISO();
const hasSamplePrice = (item: any) =>
  (item.options || []).some((g: any) => g.sample || (g.choices || []).some((c: any) => c.sample));

export default function Menu() {
  const [items, setItems] = useState<any[]>([]);
  const [perf, setPerf] = useState<Record<string, { units: number; egp: number }>>({});
  const [showNew, setShowNew] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [optId, setOptId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [bySales, setBySales] = useState(false);
  const [tidy, setTidy] = useState<any[] | null>(null);
  const [tidying, setTidying] = useState(false);
  const [form, setForm] = useState({ name: "", category: "", price: "", description: "", copyFrom: "" });
  const dragId = useRef<string | null>(null);

  const load = () => api.get("/api/menu").then((r) => setItems(r.data)).catch(() => {});
  useEffect(() => {
    load();
    api.get("/api/menu/performance").then((r) => setPerf(r.data || {})).catch(() => {});
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

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const src = items.find((i) => i.id === form.copyFrom);
    const { data: created } = await api.post("/api/menu", {
      name: form.name, category: form.category || src?.category || "Mains",
      price: Number(form.price), description: form.description || src?.description || null,
      sort_order: (Math.max(0, ...items.filter((i) => i.category === (form.category || src?.category)).map((i) => Number(i.sort_order) || 0)) + 1),
    });
    // cloning: the questions/options and dish details ride along — a new meal is
    // almost always "like that one, different name and price"
    if (src && created?.id) {
      await api.patch(`/api/menu/${created.id}`, {
        options: src.options || null,
        ingredients: src.ingredients || null,
        spice_level: src.spice_level ?? null,
        dietary_tags: src.dietary_tags || [],
      }).catch(() => {});
    }
    setShowNew(false);
    setForm({ name: "", category: form.category, price: "", description: "", copyFrom: "" });
    load();
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
            <a href={PDF_URL} target="_blank" rel="noreferrer" title="Preview the menu PDF guests receive — it regenerates automatically after edits"
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

      {showNew && (
        <Card className="mb-5 p-5">
          <form onSubmit={create} className="grid gap-3 md:grid-cols-4">
            <Input placeholder="Name *" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <div>
              <Input list="menu-cats" placeholder="Category *" required value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
              <datalist id="menu-cats">
                {[...new Set(items.map((i) => i.category))].map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
            <Input type="number" step="any" placeholder="Price *" required value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
            <Input placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <div className="md:col-span-3">
              <select value={form.copyFrom} onChange={(e) => setForm({ ...form, copyFrom: e.target.value })}
                className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200">
                <option value="">Start blank — no option questions</option>
                {items.filter((i) => (i.options || []).length).map((i) => (
                  <option key={i.id} value={i.id}>Copy questions & details from: {i.name}</option>
                ))}
              </select>
              <div className="mt-1 text-[11px] text-zinc-500">
                Meals and bundles: copy from a similar item and the combo questions (sizes, fries, drinks, bundle slots) come with it — then adjust in ⚙ options.
              </div>
            </div>
            <div className="flex items-start"><Btn type="submit">Add item</Btn></div>
          </form>
        </Card>
      )}

      {items.length === 0 ? (
        <Card><Empty text="No menu items" /></Card>
      ) : (
        categories.map((cat) => {
          const list = catItems(cat);
          const allOn = list.every((i) => i.available);
          return (
            <div key={cat} id={`cat-${cat}`} className="mb-8 scroll-mt-16">
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

// The waiter-brain fields: every one you fill kills a "the team will confirm".
function DetailsEditor({ item, onSaved }: { item: any; onSaved: () => void }) {
  const [f, setF] = useState({
    ingredients: item.ingredients || "",
    spice_level: item.spice_level ?? "",
    pairs_with: item.pairs_with || "",
    description: item.description || "",
  });
  return (
    <div className="mt-3 grid gap-2 border-t border-zinc-800 pt-3 md:grid-cols-4">
      <Input placeholder="Description" className="md:col-span-2" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      <Input placeholder="Ingredients (comma-sep)" value={f.ingredients} onChange={(e) => setF({ ...f, ingredients: e.target.value })} />
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
      <Input placeholder="Pairs well with…" value={f.pairs_with} onChange={(e) => setF({ ...f, pairs_with: e.target.value })} />
      <div className="flex items-center gap-3">
        <Btn
          className="px-3 py-1.5 text-xs"
          onClick={async () => {
            await api.patch(`/api/menu/${item.id}`, {
              description: f.description.trim() || null,
              ingredients: f.ingredients.trim() || null,
              spice_level: f.spice_level === "" ? null : Number(f.spice_level),
              pairs_with: f.pairs_with.trim() || null,
            });
            onSaved();
          }}
        >
          Save
        </Btn>
      </div>
    </div>
  );
}
