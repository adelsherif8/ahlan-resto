import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Plus, Star, Camera, Settings2, Pencil, Search, FileText, Sparkles,
  AlertTriangle, Clock, Flame, GripVertical, TrendingUp, X, Leaf, WheatOff, Copy, BarChart3,
  Rows3, Download, Upload, Check, ChevronUp, ChevronDown, Trash2,
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
  const [gap, setGap] = useState<string | null>(null);
  const [tidy, setTidy] = useState<any[] | null>(null);
  const [slug, setSlug] = useState("");
  const [menuConfig, setMenuConfig] = useState<any>({});
  const [showCats, setShowCats] = useState(false);
  const [tidying, setTidying] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [dense, setDense] = useState(() => localStorage.getItem("menu_dense") === "1");
  const [busy, setBusy] = useState("");
  const dragId = useRef<string | null>(null);

  const toggleSel = (id: string) => setSel((s) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  // Bulk write helper. Runs sequentially and reports what failed rather than claiming
  // success: a half-applied bulk edit that says "done" is how a menu quietly ends up
  // with three items on the old price.
  async function bulkPatch(ids: string[], build: (m: any) => any, label: string) {
    setBusy(label);
    let ok = 0; const failed: string[] = [];
    for (const id of ids) {
      const m = items.find((x) => String(x.id) === String(id));
      if (!m) continue;
      const body = build(m);
      if (!body || !Object.keys(body).length) continue;
      try { await api.patch(`/api/menu/${id}`, body); ok++; }
      catch { failed.push(m.name); }
    }
    setBusy("");
    await load();
    if (failed.length) alert(`${ok} updated, ${failed.length} failed:\n${failed.join(", ")}`);
    return { ok, failed };
  }

  // Rename a category = rewrite it on every item that carries it, because a category is
  // only a string on each row — there is no category table to rename.
  async function renameCategory(from: string, to: string) {
    const clean = to.trim();
    if (!clean || clean === from) return;
    const ids = items.filter((m) => m.category === from).map((m) => String(m.id));
    await bulkPatch(ids, () => ({ category: clean }), `Renaming ${from} → ${clean}`);
  }

  // Import NEVER writes straight from the file. It matches rows to existing items, works
  // out exactly which fields would change, and shows that list for approval first — a
  // spreadsheet round-trip is precisely where a stray column silently blanks 34 prices.
  const [csvPlan, setCsvPlan] = useState<any[] | null>(null);
  function parseCsv(text: string): string[][] {
    const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') quoted = false;
        else cell += c;
      } else if (c === '"') quoted = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
      else if (c !== "\r") cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((x) => String(x).trim()));
  }
  const NUMERIC = new Set(["price", "cost", "spice_level", "sort_order"]);
  const BOOLEAN = new Set(["available", "bestseller"]);
  const IMPORTABLE = ["name", "name_ar", "category", "price", "cost", "description", "ingredients", "ingredients_ar", "available", "bestseller", "spice_level", "sort_order"];

  function planImport(text: string) {
    const rows = parseCsv(text.replace(/^\uFEFF/, ""));
    if (rows.length < 2) { alert("That file has no rows."); return; }
    const head = rows[0].map((h) => h.trim().toLowerCase());
    const plan: any[] = [];
    for (const r of rows.slice(1)) {
      const rec: any = {};
      head.forEach((h, i) => { rec[h] = (r[i] ?? "").trim(); });
      const target = rec.id
        ? items.find((m) => String(m.id) === rec.id)
        : items.find((m) => String(m.name || "").toLowerCase() === String(rec.name || "").toLowerCase());
      if (!target) { plan.push({ unmatched: true, name: rec.name || "(no name)" }); continue; }
      const changes: any = {};
      for (const f of IMPORTABLE) {
        if (!(f in rec)) continue;              // column absent = field untouched
        const raw = rec[f];
        if (raw === "") continue;               // blank cell = leave alone, never blank it out
        let val: any = raw;
        if (NUMERIC.has(f)) { val = Number(raw); if (!Number.isFinite(val)) continue; }
        if (BOOLEAN.has(f)) val = /^(1|true|yes|y)$/i.test(raw);
        if (String(target[f] ?? "") === String(val)) continue;
        changes[f] = val;
      }
      if (Object.keys(changes).length) plan.push({ id: target.id, name: target.name, changes, before: target });
    }
    if (!plan.length) { alert("Nothing to change — the file matches what's already saved."); return; }
    setCsvPlan(plan);
  }

  function exportCsv() {
    const cols = ["id", "name", "name_ar", "category", "price", "cost", "description", "ingredients", "ingredients_ar", "available", "bestseller", "spice_level", "sort_order"];
    const esc = (v: any) => {
      const t = v == null ? "" : String(v);
      return /[",\n]/.test(t) ? `"${t.replaceAll('"', '""')}"` : t;
    };
    const csv = [cols.join(",")].concat(items.map((m) => cols.map((c) => esc(m[c])).join(","))).join("\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `menu-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  }


  const load = () => api.get("/api/menu").then((r) => setItems(r.data)).catch(() => {});

  // ?item=<name> — sent here from Profit ("you lose money on this") or anywhere else that
  // names a dish. Open that item's editor directly and search for it, so the fix is one
  // click from the finding instead of a hunt through the menu.
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const want = params.get("item");
    if (!want || !items.length) return;
    const hit = items.find((m: any) => String(m.name || "").toLowerCase() === want.toLowerCase());
    if (hit) { setQ(hit.name); setEditId(String(hit.id)); }
    params.delete("item");
    setParams(params, { replace: true });
  }, [items, params]);

  useEffect(() => {
    load();
    api.get("/api/menu/performance").then((r) => setPerf(r.data || {})).catch(() => {});
    api.get("/api/settings").then((r) => {
      setSlug(r.data?.slug || "");
      setMenuConfig(r.data?.menu_config || {});
    }).catch(() => {});
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

  // Bulk Arabize: the per-item ✨ already exists, but running it 30 times by hand is why
  // Arabic coverage stays patchy. Nothing is written until a human approves each line —
  // the bot reads these to Arabic guests, so an unreviewed machine translation would go
  // straight to a customer.
  const [arabizing, setArabizing] = useState(false);
  const [arabProgress, setArabProgress] = useState({ done: 0, total: 0 });
  const [arabResults, setArabResults] = useState<any[] | null>(null);
  async function runArabize() {
    const todo = items.filter((m) => !String(m.name_ar || "").trim() || !String(m.ingredients_ar || "").trim());
    if (!todo.length) { alert("Every item already has Arabic."); return; }
    setArabizing(true);
    setArabProgress({ done: 0, total: todo.length });
    const out: any[] = [];
    // sequential on purpose: this proxies to the LLM through flows, and firing 30 parallel
    // requests at it is how you get rate-limited halfway through
    for (const m of todo) {
      try {
        const { data } = await api.post("/api/menu/arabize", {
          name: m.name, ingredients: m.ingredients || "", description: m.description || "",
        });
        if (data?.name_ar || data?.ingredients_ar) {
          out.push({
            id: m.id, name: m.name,
            name_ar: !String(m.name_ar || "").trim() ? data.name_ar || "" : "",
            ingredients_ar: !String(m.ingredients_ar || "").trim() ? data.ingredients_ar || "" : "",
          });
        }
      } catch { /* one failure shouldn't abandon the rest */ }
      setArabProgress((p) => ({ ...p, done: p.done + 1 }));
    }
    setArabizing(false);
    setArabResults(out);
    if (!out.length) alert("Couldn't draft any Arabic — flows may be busy.");
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

  const configCats: any[] = Array.isArray(menuConfig.categories) ? menuConfig.categories : [];
  const orderedCategories: string[] = (() => {
    const named = [...configCats].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)).map((c) => c.name).filter(Boolean);
    const onItems = [...new Set(items.map((i: any) => i.category).filter(Boolean))] as string[];
    return [...named, ...onItems.filter((c) => !named.includes(c))];
  })();

  async function saveCategories(next: any[]) {
    await api.put("/api/settings/menu_config", { ...menuConfig, categories: next });
    setMenuConfig((c: any) => ({ ...c, categories: next }));
  }

  const gapped = gap ? filtered.filter((i) => itemGaps(i).includes(gap)) : filtered;
  const present = new Set(gapped.map((i: any) => i.category));
  const categories = orderedCategories.filter((c) => present.has(c));
  const off = items.filter((i) => !i.available).length;
  const sampleCount = items.filter(hasSamplePrice).length;

  const catItems = (cat: string) => {
    let list = gapped.filter((i) => i.category === cat);
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
            <button onClick={runArabize} disabled={arabizing} title="Draft Arabic names and ingredients for every item still missing them — you approve each one"
              className="flex items-center gap-1.5 rounded-xl border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50">
              <Sparkles size={13} /> {arabizing ? `Arabic ${arabProgress.done}/${arabProgress.total}…` : "Arabic for all"}
            </button>
            <button onClick={runTidy} disabled={tidying} title="AI proposes copy fixes (typos, truncations) — you approve each one"
              className="flex items-center gap-1.5 rounded-xl border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50">
              <Sparkles size={13} /> {tidying ? "checking…" : "Tidy descriptions"}
            </button>
            <button onClick={() => { setDense((v) => { localStorage.setItem("menu_dense", v ? "0" : "1"); return !v; }); }}
              title="Switch between cards and a dense table"
              className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs ${dense ? "border-zinc-400 text-zinc-200" : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"}`}>
              <Rows3 size={13} /> {dense ? "Cards" : "Table"}
            </button>
            <button onClick={exportCsv} title="Download every item as CSV — fill costs in a spreadsheet and import it back"
              className="flex items-center gap-1.5 rounded-xl border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800">
              <Download size={13} /> CSV
            </button>
            <label title="Import a CSV — you review every change before anything saves"
              className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800">
              <Upload size={13} /> Import
              <input type="file" accept=".csv,text/csv" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) f.text().then(planImport); e.currentTarget.value = ""; }} />
            </label>
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
            className="rounded-full bg-zinc-800/70 px-2.5 py-1 text-xs text-zinc-400 transition hover:text-zinc-100">
            {c}
          </button>
        ))}
        <button onClick={() => setBySales(!bySales)}
          className={`ml-auto flex items-center gap-1 rounded-full px-2.5 py-1 text-xs transition ${bySales ? "bg-zinc-200 font-semibold text-zinc-900" : "bg-zinc-800/70 text-zinc-400 hover:text-zinc-200"}`}>
          <TrendingUp size={11} /> by sales (30d)
        </button>
      </div>

      {/* One dialog for everything about a dish — including Options, which used to be a
          separate expanding mode. Editing a dish is one job, so it lives in one place. */}
      {(editId || optId) && (() => {
        const target = items.find((m: any) => String(m.id) === String(editId || optId));
        if (!target) return null;
        return (
          <ItemModal
            item={target}
            categories={orderedCategories}
            menuItems={items}
            startTab={optId ? "options" : "dish"}
            perf={perf[target.name]}
            onClose={() => { setEditId(null); setOptId(null); }}
            onSaved={() => { setEditId(null); setOptId(null); load(); }}
          />
        );
      })()}

      {tidy && <TidyModal fixes={tidy} onClose={() => setTidy(null)} onApplied={load} />}

      {arabResults && <ArabizeModal rows={arabResults} onClose={() => setArabResults(null)} onApplied={load} />}

      {showNew && <NewItemModal items={items} onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load(); }} />}

      {/* once, above the categories — it used to render inside the loop, so a five-category
          menu drew five identical copies of the same quadrant chart */}
      {eng && <EngineeringPanel items={items} perf={perf} />}

      <ReadinessPanel items={items} gap={gap} setGap={setGap} />

      <CategoryBar items={items} ordered={orderedCategories} onManage={() => setShowCats(true)} />

      {showCats && (
        <CategoryManager
          ordered={orderedCategories}
          configCats={configCats}
          items={items}
          busy={busy}
          onClose={() => setShowCats(false)}
          onSave={saveCategories}
          onRename={renameCategory}
        />
      )}

      {sel.size > 0 && (
        <BulkBar
          count={sel.size}
          categories={orderedCategories}
          busy={busy}
          onClear={() => setSel(new Set())}
          onMove={(cat: string) => bulkPatch([...sel], () => ({ category: cat }), "Moving").then(() => setSel(new Set()))}
          onPrice={(pct: number) => bulkPatch([...sel], (m) => ({ price: Math.round(Number(m.price) * (1 + pct / 100) * 100) / 100 }), "Repricing").then(() => setSel(new Set()))}
          onAvail={(on: boolean) => bulkPatch([...sel], () => ({ available: on }), on ? "Turning on" : "Turning off").then(() => setSel(new Set()))}
        />
      )}

      {csvPlan && <ImportModal plan={csvPlan} onClose={() => setCsvPlan(null)}
        onApply={async () => {
          const rows = csvPlan.filter((p: any) => !p.unmatched);
          await bulkPatch(rows.map((r: any) => String(r.id)),
            (m) => rows.find((r: any) => String(r.id) === String(m.id))?.changes, "Importing");
          setCsvPlan(null);
        }} />}

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
                  className="text-xs text-zinc-500 underline decoration-dotted underline-offset-2 hover:text-zinc-300"
                  title={allOn ? "Take the whole category off the menu" : "Bring the whole category back"}
                >
                  {allOn ? "turn all off" : "turn all on"}
                </button>
              </div>
              <div className="space-y-2">
                {dense ? (
                  <DenseTable list={list} perf={perf} sel={sel} toggleSel={toggleSel} patch={patch} setEditId={setEditId} />
                ) : list.map((item) => (
                  <MenuRow
                    key={item.id}
                    item={item}
                    selected={sel.has(String(item.id))}
                    onSelect={() => toggleSel(String(item.id))}
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

function MenuRow({ item, perf, editId, optId, setEditId, setOptId, categories, patch, uploadPhoto, load, dragId, onDrop, onDuplicate, selected, onSelect }: any) {
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
          <input type="checkbox" checked={!!selected} onChange={onSelect} aria-label={`Select ${item.name}`}
            className="h-4 w-4 shrink-0 cursor-pointer accent-[var(--accent)]" />
          <GripVertical size={14} className="shrink-0 cursor-grab text-zinc-700" />
          <label className="group relative h-12 w-12 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900" title="Upload photo — the bot sends it to guests">
            {item.photo_url ? (
              <img src={item.photo_url} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-amber-500/70" title="No photo — the bot can't show this dish"><Camera size={16} /></span>
            )}
            <span className="absolute inset-0 hidden items-center justify-center bg-black/60 text-xs text-white group-hover:flex">upload</span>
            <input type="file" accept="image/*" className="hidden" onChange={(e) => uploadPhoto(item, e.target.files?.[0])} />
          </label>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
              <span className="truncate">{item.name}</span>
              <ReadinessDots item={item} />
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
                <span className="flex items-center gap-1 rounded-full bg-amber-500 px-1.5 py-0.5 text-xs font-semibold text-amber-950" title="Some option prices were estimated — verify them in options">
                  <AlertTriangle size={10} /> verify price
                </span>
              )}
              {sold && (
                <span className="flex items-center gap-1 rounded-full bg-amber-500 px-1.5 py-0.5 text-xs font-semibold text-amber-950">
                  <Clock size={11} /> sold out today
                </span>
              )}
            </div>
            {item.description && <div className="truncate text-xs text-zinc-500">{item.description}</div>}
            <ModifierMargin item={item} />
            {perf && perf.units > 0 && (
              // the sales figure is a doorway, not a dead end: who actually orders this?
              <div className="text-xs text-zinc-500">
                <Link to={`/diners?item=${encodeURIComponent(item.name)}`} onClick={(e) => e.stopPropagation()}
                  className="underline decoration-dotted underline-offset-2 hover:text-zinc-300"
                  title="See the guests who order this">{perf.units} sold</Link>
                {" · "}EGP {money(Math.round(perf.egp))} (30d)
              </div>
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
            onClick={() => setOptId(item.id)}
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
            onClick={() => setEditId(item.id)}
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
                  <button onClick={() => apply(f)} className="mt-2 rounded-lg bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-900">Apply</button>
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

// Every dish carries TWO names — English and Arabic — because the bot speaks to
// Arabic guests by the Arabic menu name and answers ingredient questions from
// ingredients_ar. Staff can type them, or tap ✨ to have them drafted from the
// English (transliterated name, translated ingredients) and edit before saving.
function ArabicFields({ name, ingredients, description, nameAr, ingredientsAr, onChange }: {
  name: string; ingredients: string; description: string; nameAr: string; ingredientsAr: string;
  onChange: (v: { name_ar?: string; ingredients_ar?: string }) => void;
}) {
  const [busy, setBusy] = useState(false);
  async function draft() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const { data } = await api.post("/api/menu/arabize", { name, ingredients, description });
      onChange({ name_ar: data.name_ar || nameAr, ingredients_ar: data.ingredients_ar || ingredientsAr });
    } catch (e: any) {
      alert(e.response?.data?.error || "Couldn't draft the Arabic — type it in, or try again");
    } finally { setBusy(false); }
  }
  return (
    <>
      <div className="flex gap-2 md:col-span-1">
        <Input className="flex-1" placeholder="الاسم بالعربي" dir="rtl" value={nameAr} onChange={(e) => onChange({ name_ar: e.target.value })} />
        <button type="button" onClick={draft} disabled={!name.trim() || busy} title="Draft the Arabic name + ingredients from the English"
          className="shrink-0 rounded-xl border border-zinc-700 px-2.5 text-xs text-amber-300 hover:bg-zinc-800 disabled:opacity-40">
          {busy ? "…" : "✨ Arabic"}
        </button>
      </div>
      {/* English help text inside a dir="rtl" input gets flipped to the wrong side and
          reads as nonsense — it belongs in a label outside the field, not the placeholder */}
      <div className="md:col-span-2">
        <Input className="w-full" placeholder="المكونات بالعربي" dir="rtl" value={ingredientsAr} onChange={(e) => onChange({ ingredients_ar: e.target.value })} />
        <p className="mt-1 text-xs text-zinc-500">Arabic ingredients — the bot answers Arabic guests from these.</p>
      </div>
    </>
  );
}

// Full edit parity with adding: everything about the dish in one place —
// name, category, price, description, ingredients, spice, pairing, dietary
// tags — plus delete. Options stay in the dedicated options editor.
function DetailsEditor({ item, tab = "dish", allCategories = [], onSaved, onDirty }: { item: any; tab?: string; allCategories?: string[]; onSaved: () => void; onDirty?: (d: boolean) => void }) {
  const [f, setF] = useState({
    name: item.name || "",
    name_ar: item.name_ar || "",
    ingredients_ar: item.ingredients_ar || "",
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
  const [saving, setSaving] = useState(false);

  // Has anything actually changed? Without this the Save button looks identical whether
  // you edited something or just opened the row, and closing quietly loses your work.
  const initial = useRef(JSON.stringify(f));
  const dirty = JSON.stringify(f) !== initial.current;
  useEffect(() => { onDirty?.(dirty); }, [dirty]);

  const set = (patch: any) => setF((s: any) => ({ ...s, ...patch }));

  async function save() {
    setSaving(true);
    try {
      await api.patch(`/api/menu/${item.id}`, {
        name: f.name.trim() || item.name,
        name_ar: f.name_ar.trim() || null,
        ingredients_ar: f.ingredients_ar.trim() || null,
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
    } catch (e: any) {
      alert(e?.response?.data?.error || "Couldn't save that");
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-4"
      onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); if (dirty) save(); } }}>

      {tab === "dish" && <Group title="The dish">
        <L label="Name" full>
          <Input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Honey Mustard Cup" />
        </L>
        <L label="Category">
          <CategoryPicker value={f.category} categories={allCategories} onChange={(v: string) => set({ category: v })} />
        </L>
        <L label="Price">
          <Money value={f.price} onChange={(v) => set({ price: v })} />
        </L>
      </Group>}

      {tab === "guests" && <Group title="What the bot tells guests">
        <L label="Description" full hint="One line a guest would enjoy reading.">
          <Input value={f.description} onChange={(e) => set({ description: e.target.value })} placeholder="Sweet, tangy, made in-house" />
        </L>
        <L label="Ingredients" full
          hint={f.ingredients.trim() ? "Comma-separated." : "Comma-separated. Empty means the allergy check has nothing to read on this dish."}
          warn={!f.ingredients.trim()}>
          <Input value={f.ingredients} onChange={(e) => set({ ingredients: e.target.value })} placeholder="honey, mustard, mayonnaise" />
        </L>
        <L label="Pairs well with" hint="Suggested alongside this dish.">
          <Input value={f.pairs_with} onChange={(e) => set({ pairs_with: e.target.value })} placeholder="Chicken Tenders" />
        </L>
        <L label="Spice level">
          <select className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
            value={String(f.spice_level)} onChange={(e) => set({ spice_level: e.target.value })}>
            <option value="">Not set</option>
            <option value="0">None</option>
            <option value="1">Mild</option>
            <option value="2">Medium</option>
            <option value="3">Hot</option>
          </select>
        </L>
        <L label="Dietary" full>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {TAGS.map((t) => {
              const on = f.dietary_tags.includes(t);
              return (
                <button key={t} type="button" aria-pressed={on}
                  onClick={() => set({ dietary_tags: on ? f.dietary_tags.filter((x: string) => x !== t) : [...f.dietary_tags, t] })}
                  className={`cursor-pointer rounded-full px-3 py-1 text-xs transition ${on ? "bg-emerald-500 font-semibold text-emerald-950" : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"}`}>
                  {on ? "✓ " : ""}{t}
                </button>
              );
            })}
          </div>
        </L>
      </Group>}

      {/* Labels stay OUTSIDE the RTL inputs. English help text inside a dir="rtl" field
          gets flipped to the wrong side and reads as nonsense. */}
      {tab === "arabic" && <Group title="Arabic — what Arabic-speaking guests hear"
        action={<ArabicDraftButton name={f.name} ingredients={f.ingredients} description={f.description}
          onDrafted={(v: any) => set(v)} />}>
        <L label="Name in Arabic" hint={f.name_ar.trim() ? undefined : "Without this, Arabic guests get the English name."} warn={!f.name_ar.trim()}>
          <Input dir="rtl" value={f.name_ar} onChange={(e) => set({ name_ar: e.target.value })} placeholder="هاني ماسترد صوص" />
        </L>
        <L label="Ingredients in Arabic" hint="The bot answers Arabic ingredient questions from this.">
          <Input dir="rtl" value={f.ingredients_ar} onChange={(e) => set({ ingredients_ar: e.target.value })} placeholder="عسل، مسطردة، مايونيز" />
        </L>
      </Group>}

      {tab === "money" && <Group title="Money & stock">
        <L label="Cost to make" hint={f.cost.trim() ? "Used for margin and Profit." : "Empty means this dish is left out of Profit."} warn={!String(f.cost).trim()}>
          <Money value={f.cost} onChange={(v) => set({ cost: v })} />
        </L>
        <L label="Stock today" hint="Empty = untracked. 0 = sold out; it 86es itself for the POS and the bot.">
          <Input type="number" value={f.stock_count} onChange={(e) => set({ stock_count: e.target.value })} placeholder="untracked" />
        </L>
      </Group>}

      <div className="flex flex-wrap items-center gap-2 border-t border-zinc-800 pt-3">
        <ArmButton
          armedLabel="Sure? The bot stops knowing it exists"
          onConfirm={async () => {
            await api.delete(`/api/menu/${item.id}`).catch((e: any) => alert(e.response?.data?.error || "Delete failed"));
            onSaved();
          }}
          className="flex cursor-pointer items-center gap-1 rounded-xl border border-red-500/40 px-3 py-1.5 text-xs text-red-500 hover:bg-red-500/10"
        >
          <X size={12} /> Delete item
        </ArmButton>
        <div className="ml-auto flex items-center gap-3">
          {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
          <Btn className="px-4 py-1.5 text-xs" onClick={save} disabled={!dirty || saving}>
            {saving ? "Saving…" : dirty ? "Save" : "Saved"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

// A labelled field. The label stays visible while you type — a placeholder that vanishes
// on focus is not a label, and this form has ten of them side by side.
function L({ label, hint, warn, full, children }: { label: string; hint?: string; warn?: boolean; full?: boolean; children: any }) {
  return (
    <div className={full ? "md:col-span-2" : ""}>
      <label className="mb-1 block text-xs font-medium text-zinc-400">{label}</label>
      <div className="[&_input]:w-full [&_select]:w-full [&_textarea]:w-full">{children}</div>
      {hint && <p className={`mt-1 text-xs ${warn ? "text-amber-600" : "text-zinc-500"}`}>{hint}</p>}
    </div>
  );
}

function Group({ title, action, children }: { title: string; action?: any; children: any }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h4>
        {action}
      </div>
      <div className="grid gap-x-3 gap-y-3 md:grid-cols-2">{children}</div>
    </section>
  );
}

// currency lives in the field, not in a placeholder that disappears
function Money({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center rounded-xl border border-zinc-700 bg-zinc-900 focus-within:border-amber-500">
      <span className="pl-3 text-xs text-zinc-500">EGP</span>
      <input type="number" step="any" value={value} onChange={(e) => onChange(e.target.value)} placeholder="—"
        className="w-full bg-transparent px-2 py-2 text-sm text-zinc-100 outline-none" />
    </div>
  );
}

function ArabicDraftButton({ name, ingredients, description, onDrafted }: any) {
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" disabled={!name.trim() || busy}
      onClick={async () => {
        setBusy(true);
        try {
          const { data } = await api.post("/api/menu/arabize", { name, ingredients, description });
          const v: any = {};
          if (data?.name_ar) v.name_ar = data.name_ar;
          if (data?.ingredients_ar) v.ingredients_ar = data.ingredients_ar;
          if (Object.keys(v).length) onDrafted(v);
        } catch (e: any) {
          alert(e?.response?.data?.error || "Couldn't draft the Arabic — type it in, or try again");
        } finally { setBusy(false); }
      }}
      className="flex shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-40">
      <Sparkles size={12} /> {busy ? "drafting…" : "Draft Arabic"}
    </button>
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
  const [nameAr, setNameAr] = useState("");
  const [ingredientsAr, setIngredientsAr] = useState("");
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
        name_ar: nameAr.trim() || null,
        ingredients_ar: ingredientsAr.trim() || null,
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
              <CategoryPicker value={category} categories={[...new Set(items.map((i: any) => i.category))] as string[]} onChange={setCategory} />
            </div>
            <Input type="number" step="any" placeholder={kind === "meal" ? "Base price * (sandwich-only)" : "Price *"} value={price} onChange={(e) => setPrice(e.target.value)} />
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-zinc-700 px-3 py-2 text-xs text-zinc-400 hover:border-zinc-500">
              <Camera size={14} />
              {photo ? photo.name : "Photo (the bot sends it to guests)"}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => setPhoto(e.target.files?.[0] || null)} />
            </label>
            <Input className="md:col-span-2" placeholder="Description — what's in it, how it's made" value={description} onChange={(e) => setDescription(e.target.value)} />
            <Input placeholder="Ingredients (comma-sep — the bot answers from these)" value={ingredients} onChange={(e) => setIngredients(e.target.value)} />
            <ArabicFields name={name} ingredients={ingredients} description={description} nameAr={nameAr} ingredientsAr={ingredientsAr}
              onChange={(v) => { if (v.name_ar !== undefined) setNameAr(v.name_ar); if (v.ingredients_ar !== undefined) setIngredientsAr(v.ingredients_ar); }} />
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
                  className={`rounded-full px-2.5 py-1 text-xs ${tags.includes(t) ? "bg-emerald-500/20 text-emerald-300" : "bg-zinc-800/70 text-zinc-500"}`}>
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
                  <button onClick={() => addChoice(gi)} className="mt-1.5 text-xs text-zinc-500 underline decoration-dotted hover:text-zinc-300">+ add choice</button>
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
              <div className="mt-1.5 text-xs text-zinc-500">The bot sends a copy-paste template (FIRST CHOICE / SANDWICH / NOTES …) sized to {slotCount} and only accepts the sandwiches selected above.</div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-zinc-800 px-5 py-3">
          <div className="text-xs text-zinc-500">
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
            <p className="mb-2 text-xs text-zinc-500">{rows.length - withCost.length} item{rows.length - withCost.length > 1 ? "s" : ""} missing a cost — excluded.</p>
          )}
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            {quads.map((q) => (
              <div key={q.label} className="rounded-xl border border-zinc-800 p-3">
                <div className={`mb-1.5 text-xs font-semibold ${q.tone}`}>{q.label} · {q.list.length}</div>
                {q.list.slice(0, 5).map((r: any) => (
                  <div key={r.name} className="flex justify-between text-xs text-zinc-400">
                    <span className="truncate pr-1">{r.name}</span>
                    <span className="shrink-0 tabular-nums">{r.units}u · {Math.round(r.margin)} EGP</span>
                  </div>
                ))}
                {q.list.length === 0 && <div className="text-xs text-zinc-700">—</div>}
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

// ---------- readiness ----------
// The menu is where everything the bot knows comes from, so a blank field here is never
// cosmetic — it silently switches a capability off somewhere else in the product. Each
// gap is therefore named by its CONSEQUENCE, not as a completeness score: "12 dishes the
// allergy check can't read" is actionable in a way that "78% complete" never is.

const GAPS: { key: string; label: string; missing: (m: any) => boolean; consequence: string }[] = [
  { key: "ingredients", label: "ingredients", missing: (m) => !String(m.ingredients || "").trim(),
    consequence: "the allergy check has nothing to read on these — it cannot warn staff about them" },
  { key: "arabic", label: "Arabic name", missing: (m) => !String(m.name_ar || "").trim(),
    consequence: "Arabic-speaking guests get the English name from a bot meant to speak their language" },
  { key: "cost", label: "cost", missing: (m) => m.cost == null || m.cost === "",
    consequence: "these are left out of Profit, so your margin only covers part of the menu" },
  { key: "photo", label: "photo", missing: (m) => !m.photo_url,
    consequence: "the bot can't show the dish when a guest asks what it looks like" },
];

export function itemGaps(m: any): string[] {
  return GAPS.filter((g) => g.missing(m)).map((g) => g.key);
}

// four marks per row, so gaps are visible while scanning instead of one modal at a time
function ReadinessDots({ item }: { item: any }) {
  const missing = new Set(itemGaps(item));
  return (
    <span className="flex shrink-0 items-center gap-1" aria-label={missing.size ? `Missing: ${[...missing].join(", ")}` : "Complete"}>
      {GAPS.map((g) => (
        <span key={g.key} title={missing.has(g.key) ? `No ${g.label} — ${g.consequence}` : `${g.label} ✓`}
          className={`h-1.5 w-1.5 rounded-full ${missing.has(g.key) ? "bg-amber-500" : "bg-emerald-500"}`} />
      ))}
    </span>
  );
}

function ReadinessPanel({ items, gap, setGap }: { items: any[]; gap: string | null; setGap: (g: string | null) => void }) {
  if (!items.length) return null;
  const rows = GAPS.map((g) => ({ ...g, count: items.filter(g.missing).length })).filter((g) => g.count > 0);
  if (!rows.length) return (
    <Card className="mb-5 p-4">
      <div className="text-sm text-emerald-400">
        Every dish has ingredients, an Arabic name, a cost and a photo — the bot, the allergy check and Profit all have what they need.
      </div>
    </Card>
  );
  return (
    <Card className="mb-5 p-4">
      <div className="mb-2 text-sm font-semibold text-zinc-200">What's missing</div>
      <div className="space-y-1.5">
        {rows.map((g) => (
          <button key={g.key} onClick={() => setGap(gap === g.key ? null : g.key)}
            className={`flex w-full cursor-pointer items-baseline gap-2 rounded-lg px-2 py-1.5 text-left transition ${gap === g.key ? "bg-zinc-800" : "hover:bg-zinc-900"}`}>
            <span className="shrink-0 text-sm font-bold tabular-nums text-amber-500">{g.count}</span>
            <span className="text-xs text-zinc-300">
              {g.count === 1 ? "dish has" : "dishes have"} no {g.label}
              <span className="text-zinc-500"> — {g.consequence}</span>
            </span>
            <span className="ml-auto shrink-0 text-xs text-zinc-600">{gap === g.key ? "showing these" : "show"}</span>
          </button>
        ))}
      </div>
    </Card>
  );
}

// Review screen for bulk Arabize. Editable before saving, because a machine translation of
// a dish name is a suggestion — the bot reads this aloud to Arabic guests, and "Smoky BBQ
// Burger" mistranslated is a menu error the kitchen never sees.
function ArabizeModal({ rows, onClose, onApplied }: { rows: any[]; onClose: () => void; onApplied: () => void }) {
  const [draft, setDraft] = useState(rows);
  const [saving, setSaving] = useState(false);

  async function applyAll() {
    setSaving(true);
    for (const r of draft) {
      const patch: any = {};
      if (String(r.name_ar || "").trim()) patch.name_ar = r.name_ar.trim();
      if (String(r.ingredients_ar || "").trim()) patch.ingredients_ar = r.ingredients_ar.trim();
      if (Object.keys(patch).length) await api.patch(`/api/menu/${r.id}`, patch).catch(() => {});
    }
    setSaving(false);
    onApplied();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="grid max-h-[85vh] w-full max-w-3xl grid-rows-[auto_1fr_auto] overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-zinc-800 p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><Sparkles size={14} /> Arabic drafts ({draft.length})</h2>
          <button onClick={onClose} aria-label="Close"><X size={16} className="text-zinc-500 hover:text-zinc-200" /></button>
        </div>
        <div className="overflow-y-auto p-4">
          <p className="mb-3 text-xs text-zinc-500">Edit anything that reads wrong before saving — guests see these, not you.</p>
          <div className="space-y-3">
            {draft.map((r, i) => (
              <div key={r.id} className="rounded-xl border border-zinc-800 p-3">
                <div className="mb-1.5 text-xs font-medium text-zinc-300">{r.name}</div>
                <div className="grid gap-2 md:grid-cols-2">
                  <Input dir="rtl" placeholder="الاسم بالعربي" value={r.name_ar}
                    onChange={(e) => setDraft((d) => d.map((x, n) => (n === i ? { ...x, name_ar: e.target.value } : x)))} />
                  <Input dir="rtl" placeholder="المكونات بالعربي" value={r.ingredients_ar}
                    onChange={(e) => setDraft((d) => d.map((x, n) => (n === i ? { ...x, ingredients_ar: e.target.value } : x)))} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-zinc-800 p-4">
          <button onClick={onClose} className="cursor-pointer rounded-xl border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800">Cancel</button>
          <Btn onClick={applyAll} disabled={saving}>{saving ? "Saving…" : `Save all ${draft.length}`}</Btn>
        </div>
      </div>
    </div>
  );
}

// ---------- bulk editing ----------
// Menus are maintained in sweeps — "put all the drinks up 10%", "take the specials off" —
// and doing that one modal at a time is why menus drift out of date.

function BulkBar({ count, categories, busy, onClear, onMove, onPrice, onAvail }: any) {
  const [pct, setPct] = useState("10");
  return (
    <Card className="mb-4 flex flex-wrap items-center gap-2 border-zinc-600 p-3">
      <span className="text-sm font-semibold text-zinc-100">{count} selected</span>
      <span className="mx-1 h-4 w-px bg-zinc-700" />
      <select defaultValue="" aria-label="Move to category"
        onChange={(e) => {
          const v = e.target.value;
          e.target.value = "";
          if (!v) return;
          if (v === "__new") {
            const typed = window.prompt("Name the new category")?.trim();
            // reuse an existing section's exact spelling if it only differs by case
            const name = typed && (categories.find((c: string) => c.toLowerCase() === typed.toLowerCase()) || typed);
            if (name) onMove(name);        // the category exists the moment an item is in it
            return;
          }
          onMove(v);
        }}
        className="cursor-pointer rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200">
        <option value="">Move to…</option>
        {categories.map((c: string) => <option key={c} value={c}>{c}</option>)}
        <option value="__new">+ New category…</option>
      </select>
      <span className="flex items-center gap-1">
        <input type="number" value={pct} onChange={(e) => setPct(e.target.value)} aria-label="Percent"
          className="w-16 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-right text-xs text-zinc-200" />
        <span className="text-xs text-zinc-500">%</span>
        <button onClick={() => onPrice(Number(pct))} className="cursor-pointer rounded-lg border border-zinc-700 px-2 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800">raise</button>
        <button onClick={() => onPrice(-Math.abs(Number(pct)))} className="cursor-pointer rounded-lg border border-zinc-700 px-2 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800">cut</button>
      </span>
      <button onClick={() => onAvail(true)} className="cursor-pointer rounded-lg border border-zinc-700 px-2 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800">Turn on</button>
      <button onClick={() => onAvail(false)} className="cursor-pointer rounded-lg border border-zinc-700 px-2 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800">Turn off</button>
      {busy && <span className="text-xs text-zinc-400">{busy}…</span>}
      <button onClick={onClear} className="ml-auto cursor-pointer text-xs text-zinc-500 hover:text-zinc-300">clear</button>
    </Card>
  );
}

// A category is just a string repeated on every item, so renaming one means rewriting all
// of them. That's fine — but it has to be one deliberate action, not 34 manual edits.
function CategoryBar({ items, ordered, onManage }: any) {
  if (!ordered.length) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <span className="text-xs text-zinc-500">Sections in this order:</span>
      {ordered.map((c: string, i: number) => {
        const n = items.filter((x: any) => x.category === c).length;
        return (
          <span key={c} className="flex items-center gap-1 rounded-full bg-zinc-800/70 px-2.5 py-1 text-xs text-zinc-300">
            <span className="text-zinc-600">{i + 1}.</span> {c}
            <span className={n ? "text-zinc-500" : "text-amber-600"}>{n || "empty"}</span>
          </span>
        );
      })}
      <button onClick={onManage}
        className="cursor-pointer rounded-full border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800">
        Manage sections
      </button>
    </div>
  );
}

// Import preview. Shows old → new per field; nothing is written until this is approved.
function ImportModal({ plan, onClose, onApply }: { plan: any[]; onClose: () => void; onApply: () => void }) {
  const matched = plan.filter((p) => !p.unmatched);
  const unmatched = plan.filter((p) => p.unmatched);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="grid max-h-[85vh] w-full max-w-3xl grid-rows-[auto_1fr_auto] overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-zinc-800 p-4">
          <h2 className="text-sm font-semibold">Review import — {matched.length} item{matched.length === 1 ? "" : "s"} would change</h2>
          <button onClick={onClose} aria-label="Close"><X size={16} className="text-zinc-500 hover:text-zinc-200" /></button>
        </div>
        <div className="overflow-y-auto p-4">
          <p className="mb-3 text-xs text-zinc-500">
            Blank cells are ignored, never treated as "erase this". Columns you left out aren't touched at all.
          </p>
          {unmatched.length > 0 && (
            <div className="mb-3 rounded-lg border border-amber-500 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {unmatched.length} row{unmatched.length === 1 ? "" : "s"} matched no existing item and will be skipped: {unmatched.map((u) => u.name).join(", ")}
            </div>
          )}
          <div className="space-y-2">
            {matched.map((p) => (
              <div key={p.id} className="rounded-xl border border-zinc-800 p-3">
                <div className="mb-1 text-xs font-semibold text-zinc-200">{p.name}</div>
                {Object.entries(p.changes).map(([f, v]) => (
                  <div key={f} className="flex flex-wrap items-baseline gap-2 text-xs">
                    <span className="w-28 shrink-0 text-zinc-500">{f}</span>
                    <span className="text-zinc-500 line-through">{String(p.before?.[f] ?? "—") || "—"}</span>
                    <span className="text-zinc-100">{String(v)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-zinc-800 p-4">
          <button onClick={onClose} className="cursor-pointer rounded-xl border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800">Cancel</button>
          <Btn onClick={onApply} disabled={!matched.length}>Apply {matched.length} change{matched.length === 1 ? "" : "s"}</Btn>
        </div>
      </div>
    </div>
  );
}

// Dense table: 34 cards is a lot of scrolling when all you want is to scan prices or fill
// in costs. Same data, one line each, name/category/price editable in place.
function DenseTable({ list, perf, sel, toggleSel, patch, setEditId }: any) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-zinc-500">
          <tr className="border-b border-zinc-800">
            <th className="w-8 pb-1.5"></th>
            <th className="pb-1.5 text-left font-medium">Dish</th>
            <th className="pb-1.5 text-left font-medium">Ready</th>
            <th className="pb-1.5 text-right font-medium">Price</th>
            <th className="pb-1.5 text-right font-medium">Cost</th>
            <th className="pb-1.5 text-right font-medium">Margin</th>
            <th className="pb-1.5 text-right font-medium">30d</th>
            <th className="w-8 pb-1.5"></th>
          </tr>
        </thead>
        <tbody>
          {list.map((m: any) => {
            const margin = m.cost != null && m.cost !== "" ? Number(m.price) - Number(m.cost) : null;
            const pct = margin != null && Number(m.price) > 0 ? Math.round((margin / Number(m.price)) * 100) : null;
            return (
              <tr key={m.id} className={`border-b border-zinc-900 ${m.available ? "" : "opacity-50"}`}>
                <td className="py-1.5">
                  <input type="checkbox" checked={sel.has(String(m.id))} onChange={() => toggleSel(String(m.id))}
                    aria-label={`Select ${m.name}`} className="h-4 w-4 cursor-pointer accent-[var(--accent)]" />
                </td>
                <td className="max-w-[1px] truncate py-1.5 pr-2 text-zinc-200">{m.name}</td>
                <td className="py-1.5"><ReadinessDots item={m} /></td>
                <td className="py-1.5 text-right tabular-nums text-zinc-200">{money(m.price)}</td>
                <td className="py-1.5 text-right tabular-nums text-zinc-400">{m.cost == null || m.cost === "" ? "—" : money(m.cost)}</td>
                <td className={`py-1.5 text-right tabular-nums ${margin == null ? "text-zinc-600" : margin <= 0 ? "text-red-500" : "text-zinc-300"}`}>
                  {margin == null ? "—" : `${money(margin)}${pct != null ? ` · ${pct}%` : ""}`}
                </td>
                <td className="py-1.5 text-right tabular-nums text-zinc-500">{perf[m.name]?.units || 0}</td>
                <td className="py-1.5 text-right">
                  <button onClick={() => setEditId(String(m.id))} aria-label={`Edit ${m.name}`}
                    className="cursor-pointer text-zinc-500 hover:text-zinc-200"><Pencil size={12} /></button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------- what an item really sells for ----------
// The listed price is a fiction on any item with options: a size choice can REPLACE the
// base price and an extra ADDS to it, so a "140 EGP" dish may actually leave the pass at
// anywhere from 140 to 210. Margin computed off the base price alone is wrong for exactly
// the items that matter most — the modifier-heavy ones.
export function priceRange(m: any): { min: number; max: number; varies: boolean } {
  const base = Number(m.price) || 0;
  let bases = [base];
  let addMin = 0, addMax = 0;
  for (const g of m.options || []) {
    const choices = g.choices || [];
    const overrides = choices.filter((c: any) => c.price != null).map((c: any) => Number(c.price)).filter(Number.isFinite);
    if (overrides.length) bases = g.required === false ? [...bases, ...overrides] : overrides;
    const deltas = choices.filter((c: any) => c.delta).map((c: any) => Number(c.delta)).filter(Number.isFinite);
    if (deltas.length) {
      // an optional group can always be declined, so its floor is 0
      addMin += Math.min(0, ...deltas);
      addMax += g.multi ? deltas.filter((d: number) => d > 0).reduce((a: number, b: number) => a + b, 0) : Math.max(0, ...deltas);
    }
  }
  const min = Math.min(...bases) + addMin;
  const max = Math.max(...bases) + addMax;
  return { min, max, varies: Math.round(min) !== Math.round(max) };
}

function ModifierMargin({ item }: { item: any }) {
  const r = priceRange(item);
  if (!r.varies) return null;
  const cost = item.cost == null || item.cost === "" ? null : Number(item.cost);
  return (
    <div className="text-xs text-zinc-500">
      with options {money(r.min)}–{money(r.max)} EGP
      {cost != null && (
        <> · margin <span className={r.min - cost <= 0 ? "text-red-500" : ""}>{money(r.min - cost)}–{money(r.max - cost)}</span></>
      )}
    </div>
  );
}

// ---------- one dialog per dish ----------
// Editing a dish used to expand inline, which reflowed the whole list under you, and its
// Options lived in a second, separate expander. Both are one job — "change this dish" —
// so both live in one dialog with tabs, and the list stays exactly where you left it.
const ITEM_TABS: { key: string; label: string }[] = [
  { key: "dish", label: "The dish" },
  { key: "guests", label: "What guests hear" },
  { key: "arabic", label: "Arabic" },
  { key: "options", label: "Options" },
  { key: "money", label: "Money & stock" },
];

function ItemModal({ item, categories, menuItems, startTab, perf, onClose, onSaved }: any) {
  const [tab, setTab] = useState(startTab || "dish");
  const [dirty, setDirty] = useState(false);

  // Closing with unsaved edits is the one place a click can destroy work here, so it asks.
  const tryClose = () => {
    if (dirty && !window.confirm("You have unsaved changes to this dish. Close anyway?")) return;
    onClose();
  };

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") tryClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [dirty]);

  const gaps = new Set(itemGaps(item));
  // a tab that hides a problem is worse than no tab — mark the ones with gaps
  const tabGap: Record<string, boolean> = {
    guests: gaps.has("ingredients"),
    arabic: gaps.has("arabic"),
    money: gaps.has("cost"),
    dish: gaps.has("photo"),
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center" onClick={tryClose}>
      <div role="dialog" aria-modal="true" aria-label={`Edit ${item.name}`}
        className="grid max-h-[90vh] w-full max-w-3xl grid-rows-[auto_auto_1fr] overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}>

        <div className="flex items-center gap-3 border-b border-zinc-800 p-4">
          {item.photo_url
            ? <img src={item.photo_url} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover" />
            : <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-zinc-700 text-zinc-600"><Camera size={16} /></span>}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-zinc-100">{item.name}</div>
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <span>{item.category} · EGP {money(item.price)}</span>
              <ReadinessDots item={item} />
              {perf?.units > 0 && <span>· {perf.units} sold in 30d</span>}
            </div>
          </div>
          <button onClick={tryClose} aria-label="Close" className="cursor-pointer rounded-lg p-1 text-zinc-500 hover:text-zinc-200"><X size={18} /></button>
        </div>

        <div className="flex gap-1 overflow-x-auto border-b border-zinc-800 px-3 py-2" role="tablist">
          {ITEM_TABS.map((t) => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
              className={`flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition ${
                tab === t.key ? "bg-zinc-800 font-semibold text-zinc-100" : "text-zinc-400 hover:text-zinc-200"}`}>
              {t.label}
              {tabGap[t.key] && <span title="Something's missing here" className="h-1.5 w-1.5 rounded-full bg-amber-500" />}
            </button>
          ))}
        </div>

        <div className="overflow-y-auto p-4">
          {/* hidden, not unmounted: switching to Options and back must not lose typing */}
          <div className={tab === "options" ? "hidden" : ""}>
            <DetailsEditor item={item} tab={tab} allCategories={categories} onSaved={onSaved} onDirty={setDirty} />
          </div>
          {tab === "options" && <OptionsEditor item={item} categories={categories} menuItems={menuItems} onSaved={onSaved} />}
        </div>
      </div>
    </div>
  );
}

// Pick an existing category or make a new one. It used to be a bare text box, which meant
// you couldn't see what already existed and a typo ("Sauce" vs "Sauces") silently created
// a second category that then showed up as its own section on the menu.
//
// There is no category table — a category exists exactly as long as an item says it does —
// so "create" here just means typing a name that nothing uses yet.
function CategoryPicker({ value, categories, onChange }: { value: string; categories: string[]; onChange: (v: string) => void }) {
  const known = categories.filter(Boolean);
  const [custom, setCustom] = useState(() => !!value && !known.includes(value));

  // Snap to an existing section's exact spelling when the typed name only differs by case
  // or whitespace. Flows resolves configured categories case-insensitively but then filters
  // items with ===, so "sauces" on an item under a "Sauces" section makes the whole section
  // vanish from the guest's PDF with no error anywhere.
  const snap = (v: string) => {
    const t = v.trim();
    return known.find((k) => k.toLowerCase() === t.toLowerCase()) ?? t;
  };

  if (custom) {
    return (
      <div>
        <Input autoFocus value={value} onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => onChange(snap(e.target.value))} placeholder="New category name" />
        {known.length > 0 && (
          <button type="button" onClick={() => { setCustom(false); onChange(known[0]); }}
            className="mt-1 cursor-pointer text-xs text-zinc-500 hover:text-zinc-300">
            ← pick an existing one instead
          </button>
        )}
      </div>
    );
  }
  return (
    <select value={known.includes(value) ? value : ""}
      onChange={(e) => { if (e.target.value === "__new") { setCustom(true); onChange(""); } else onChange(e.target.value); }}
      className="w-full cursor-pointer rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200">
      <option value="" disabled>Choose a category…</option>
      {known.map((c) => <option key={c} value={c}>{c}</option>)}
      <option value="__new">+ New category…</option>
    </select>
  );
}

// ---------- categories as real, ordered things ----------
// A category used to exist only as a string repeated on items, which meant three things
// were impossible: setting the order sections appear in, giving a section an Arabic name,
// and creating a section before it has any dishes. They now live in
// menu_config.categories as [{ name, name_ar, sort }].
//
// Items still store the category NAME, not an id, so nothing about the existing menu has
// to be migrated and the bot keeps reading exactly what it reads today. The trade-off is
// that renaming still rewrites every affected item — which is what the rename does.
function CategoryManager({ ordered, configCats, items, busy, onClose, onSave, onRename }: any) {
  const [rows, setRows] = useState<any[]>(() =>
    ordered.map((name: string, i: number) => {
      const cfg = configCats.find((c: any) => c.name === name) || {};
      return { name, name_ar: cfg.name_ar || "", sort: i, _original: name };
    }));
  const [saving, setSaving] = useState(false);

  const count = (name: string) => items.filter((i: any) => i.category === name).length;
  const move = (i: number, dir: -1 | 1) => setRows((r) => {
    const n = [...r]; const j = i + dir;
    if (j < 0 || j >= n.length) return r;
    [n[i], n[j]] = [n[j], n[i]];
    return n.map((x, k) => ({ ...x, sort: k }));
  });

  async function save() {
    setSaving(true);
    try {
      // renames first — they rewrite items, and the config must end up agreeing with them
      for (const r of rows) {
        if (r._original && r.name.trim() && r.name.trim() !== r._original) {
          await onRename(r._original, r.name.trim());
        }
      }
      await onSave(rows
        .filter((r) => r.name.trim())
        .map((r, i) => ({ name: r.name.trim(), name_ar: r.name_ar.trim() || undefined, sort: i })));
      onClose();
    } catch (e: any) {
      alert(e?.response?.data?.error || "Couldn't save the sections");
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Manage sections"
        className="grid max-h-[85vh] w-full max-w-2xl grid-rows-[auto_1fr_auto] overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-zinc-800 p-4">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Menu sections</h2>
            <p className="text-xs text-zinc-500">The order here is the order guests see.</p>
          </div>
          <button onClick={onClose} aria-label="Close"><X size={16} className="text-zinc-500 hover:text-zinc-200" /></button>
        </div>

        <div className="space-y-2 overflow-y-auto p-4">
          {rows.map((r, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-800 p-2">
              <span className="flex shrink-0 flex-col">
                <button onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up"
                  className="cursor-pointer text-zinc-600 hover:text-zinc-200 disabled:opacity-30"><ChevronUp size={13} /></button>
                <button onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label="Move down"
                  className="cursor-pointer text-zinc-600 hover:text-zinc-200 disabled:opacity-30"><ChevronDown size={13} /></button>
              </span>
              <Input className="min-w-[140px] flex-1" value={r.name} placeholder="Section name"
                onChange={(e) => setRows((x) => x.map((y, k) => (k === i ? { ...y, name: e.target.value } : y)))} />
              <Input className="min-w-[140px] flex-1" dir="rtl" value={r.name_ar} placeholder="الاسم بالعربي"
                onChange={(e) => setRows((x) => x.map((y, k) => (k === i ? { ...y, name_ar: e.target.value } : y)))} />
              <span className={`w-16 shrink-0 text-center text-xs ${count(r._original) ? "text-zinc-500" : "text-amber-600"}`}>
                {count(r._original) || "empty"}
              </span>
              <button
                onClick={() => {
                  if (count(r._original) > 0) { alert(`“${r._original}” still has ${count(r._original)} dish(es). Move them to another section first.`); return; }
                  setRows((x) => x.filter((_, k) => k !== i));
                }}
                aria-label={`Remove ${r.name}`}
                className="cursor-pointer rounded-lg border border-zinc-700 p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-red-500">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          <button onClick={() => setRows((r) => [...r, { name: "", name_ar: "", sort: r.length, _original: "" }])}
            className="cursor-pointer rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800">
            + Add a section
          </button>
          <p className="pt-1 text-xs text-zinc-500">
            Renaming a section rewrites it on every dish in it. A section with no dishes is kept here, so you can set one up before adding to it.
          </p>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-zinc-800 p-4">
          <button onClick={onClose} className="cursor-pointer rounded-xl border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800">Cancel</button>
          <div className="flex items-center gap-2">
            {busy && <span className="text-xs text-zinc-400">{busy}…</span>}
            <Btn onClick={save} disabled={saving}>{saving ? "Saving…" : "Save sections"}</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}
