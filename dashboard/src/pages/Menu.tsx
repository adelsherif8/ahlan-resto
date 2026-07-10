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
  const [form, setForm] = useState({ name: "", category: "Mains", price: "", description: "" });

  const load = () => api.get("/api/menu").then((r) => setItems(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

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
                <Card key={item.id} className={`flex items-center justify-between gap-3 px-4 py-3 ${item.available ? "" : "opacity-50"}`}>
                  <div>
                    <div className="text-sm font-medium">
                      {item.name}{" "}
                      {(item.dietary_tags || []).map((t: string) => (
                        <span key={t} title={t}>{TAG_EMOJI[t] || ""}</span>
                      ))}
                    </div>
                    {item.description && <div className="text-xs text-zinc-500">{item.description}</div>}
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-sm font-semibold tabular-nums">EGP {Number(item.price).toFixed(0)}</div>
                    <button
                      onClick={() => toggle86(item)}
                      className={`relative h-6 w-11 rounded-full transition ${item.available ? "bg-emerald-500" : "bg-zinc-700"}`}
                      title={item.available ? "Available — click to 86" : "86'd — click to restore"}
                    >
                      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${item.available ? "left-[22px]" : "left-0.5"}`} />
                    </button>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
