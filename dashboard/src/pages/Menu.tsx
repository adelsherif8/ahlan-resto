import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { api } from "../config/api";
import { Card, PageHeader, Btn, Input, Empty } from "../components/ui";

const TAG_EMOJI: Record<string, string> = {
  vegan: "🌱", vegetarian: "🥬", gf: "🌾", nuts: "🥜", dairy: "🥛", spicy: "🌶️",
};

export default function Menu() {
  const [items, setItems] = useState<any[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", category: "Mains", price: "", description: "" });

  const load = () => api.get("/api/menu").then((r) => setItems(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

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

  async function toggle86(item: any) {
    setItems((xs) => xs.map((x) => (x.id === item.id ? { ...x, available: !x.available } : x)));
    await api.patch(`/api/menu/${item.id}`, { available: !item.available }).catch(load);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    await api.post("/api/menu", { ...form, price: Number(form.price) });
    setShowNew(false);
    setForm({ name: "", category: form.category, price: "", description: "" });
    load();
  }

  const categories = [...new Set(items.map((i) => i.category))];
  const off = items.filter((i) => !i.available).length;

  return (
    <div>
      <PageHeader
        title="Menu"
        subtitle={`${items.length} items${off ? ` · ${off} currently 86'd (hidden from the bot)` : ""}`}
        actions={<Btn onClick={() => setShowNew((v) => !v)}><span className="flex items-center gap-1.5"><Plus size={15} /> New item</span></Btn>}
      />

      {showNew && (
        <Card className="mb-5 p-5">
          <form onSubmit={create} className="grid gap-3 md:grid-cols-4">
            <Input placeholder="Name *" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input placeholder="Category *" required value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            <Input type="number" placeholder="Price *" required value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
            <Input placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <div className="md:col-span-4"><Btn type="submit">Add item</Btn></div>
          </form>
        </Card>
      )}

      {items.length === 0 ? (
        <Card><Empty text="No menu items" /></Card>
      ) : (
        categories.map((cat) => (
          <div key={cat} className="mb-8">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-amber-400">{cat}</h2>
            <div className="space-y-2">
              {items.filter((i) => i.category === cat).map((item) => (
                <Card key={item.id} className={`px-4 py-3 ${item.available ? "" : "opacity-50"}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <label className="group relative h-12 w-12 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900" title="Upload photo — the bot sends it to guests">
                      {item.photo_url ? (
                        <img src={item.photo_url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center text-lg text-zinc-600">📷</span>
                      )}
                      <span className="absolute inset-0 hidden items-center justify-center bg-black/60 text-[10px] text-white group-hover:flex">upload</span>
                      <input type="file" accept="image/*" className="hidden" onChange={(e) => uploadPhoto(item, e.target.files?.[0])} />
                    </label>
                    <div>
                      <div className="text-sm font-medium">
                        {item.name}{" "}
                        {(item.dietary_tags || []).map((t: string) => (
                          <span key={t} title={t}>{TAG_EMOJI[t] || ""}</span>
                        ))}
                        {item.bestseller && <span title="bestseller"> ⭐</span>}
                        {item.spice_level ? <span title={`spice ${item.spice_level}/3`}> {"🌶".repeat(item.spice_level)}</span> : null}
                      </div>
                      {item.description && <div className="text-xs text-zinc-500">{item.description}</div>}
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-sm font-semibold tabular-nums">EGP {Number(item.price).toFixed(0)}</div>
                    <button
                      onClick={() => setEditId(editId === item.id ? null : item.id)}
                      className="rounded-lg border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800"
                      title="Dish details the bot uses to answer questions"
                    >
                      ✎ details
                    </button>
                    <button
                      onClick={() => toggle86(item)}
                      className={`relative h-6 w-11 rounded-full transition ${item.available ? "bg-emerald-500" : "bg-zinc-700"}`}
                      title={item.available ? "Available — click to 86" : "86'd — click to restore"}
                    >
                      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${item.available ? "left-[22px]" : "left-0.5"}`} />
                    </button>
                  </div>
                </div>
                {editId === item.id && (
                  <DetailsEditor item={item} onSaved={() => { setEditId(null); load(); }} />
                )}
                </Card>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// The waiter-brain fields: every one you fill kills a "the team will confirm".
function DetailsEditor({ item, onSaved }: { item: any; onSaved: () => void }) {
  const [f, setF] = useState({
    ingredients: item.ingredients || "",
    spice_level: item.spice_level ?? "",
    pairs_with: item.pairs_with || "",
    bestseller: !!item.bestseller,
  });
  return (
    <div className="mt-3 grid gap-2 border-t border-zinc-800 pt-3 md:grid-cols-4">
      <Input placeholder="Ingredients (comma-sep)" value={f.ingredients} onChange={(e) => setF({ ...f, ingredients: e.target.value })} />
      <select
        className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
        value={String(f.spice_level)}
        onChange={(e) => setF({ ...f, spice_level: e.target.value })}
      >
        <option value="">Spice: unknown</option>
        <option value="0">Spice: 0 (none)</option>
        <option value="1">Spice: 🌶 mild</option>
        <option value="2">Spice: 🌶🌶 medium</option>
        <option value="3">Spice: 🌶🌶🌶 hot</option>
      </select>
      <Input placeholder="Pairs well with…" value={f.pairs_with} onChange={(e) => setF({ ...f, pairs_with: e.target.value })} />
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs text-zinc-300">
          <input type="checkbox" checked={f.bestseller} onChange={(e) => setF({ ...f, bestseller: e.target.checked })} /> ⭐ bestseller
        </label>
        <Btn
          className="px-3 py-1.5 text-xs"
          onClick={async () => {
            await api.patch(`/api/menu/${item.id}`, {
              ingredients: f.ingredients.trim() || null,
              spice_level: f.spice_level === "" ? null : Number(f.spice_level),
              pairs_with: f.pairs_with.trim() || null,
              bestseller: f.bestseller,
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
