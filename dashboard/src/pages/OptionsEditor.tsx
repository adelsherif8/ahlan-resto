import { useState } from "react";
import { Plus, Trash2, AlertTriangle } from "lucide-react";
import { api } from "../config/api";
import { Btn, Input } from "../components/ui";

// The questions a cashier asks before an item is orderable. Each group becomes one
// WhatsApp question; the bot asks them in this order, for one item at a time.
export type Choice = { name: string; price?: number; delta?: number; sample?: boolean };
export type Group = {
  key: string;
  label: string;
  required?: boolean;
  count?: number;
  when?: Record<string, string | string[]>;
  from_category?: string;
  choices?: Choice[];
  sample?: boolean;
};

const blank = (): Group => ({ key: "", label: "", required: true, choices: [{ name: "" }] });

export default function OptionsEditor({
  item, categories, onSaved,
}: { item: any; categories: string[]; onSaved: () => void }) {
  const [groups, setGroups] = useState<Group[]>(() => JSON.parse(JSON.stringify(item.options || [])));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const patch = (i: number, p: Partial<Group>) =>
    setGroups((gs) => gs.map((g, x) => (x === i ? { ...g, ...p } : g)));
  const patchChoice = (gi: number, ci: number, p: Partial<Choice>) =>
    setGroups((gs) => gs.map((g, x) => x !== gi ? g
      : { ...g, choices: (g.choices || []).map((c, y) => (y === ci ? { ...c, ...p, sample: undefined } : c)) }));

  async function save() {
    // a group with no key or no way to offer anything can never be answered
    const clean = groups
      .map((g) => ({
        ...g,
        key: (g.key || g.label || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
        label: g.label || g.key,
        choices: g.from_category ? undefined : (g.choices || []).filter((c) => c.name.trim()),
      }))
      .filter((g) => g.key && (g.from_category || (g.choices || []).length));
    setSaving(true); setErr("");
    try {
      await api.patch(`/api/menu/${item.id}`, { options: clean });
      onSaved();
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Save failed");
    } finally { setSaving(false); }
  }

  const earlierKeys = (i: number) => groups.slice(0, i).map((g) => g.key).filter(Boolean);
  const hasSample = groups.some((g) => g.sample || (g.choices || []).some((c) => c.sample));

  return (
    <div className="mt-3 border-t border-zinc-800 pt-3">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">Ordering questions</div>
          <p className="text-xs text-zinc-500">
            Asked in order, one at a time, before this item can be ordered.
            Price replaces the item price; +Extra adds to it.
          </p>
        </div>
        <Btn variant="ghost" onClick={() => setGroups((gs) => [...gs, blank()])}>
          <span className="flex items-center gap-1.5"><Plus size={14} /> Question</span>
        </Btn>
      </div>

      {hasSample && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            Values marked <b>sample</b> were filled in as placeholders — guests will be charged
            them. Replace with your real prices; editing a field clears the flag.
          </span>
        </div>
      )}

      {groups.length === 0 && (
        <p className="py-3 text-xs text-zinc-500">
          No questions — guests can order this item straight away.
        </p>
      )}

      <div className="space-y-3">
        {groups.map((g, i) => (
          <div key={i} className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Input
                className="flex-1 min-w-[160px]"
                placeholder="Question, e.g. Sandwich or combo"
                value={g.label}
                onChange={(e) => patch(i, { label: e.target.value, sample: undefined })}
              />
              <label className="flex items-center gap-1 text-xs text-zinc-400" title="How many they must pick — 4 for a bundle of 4 sandwiches">
                pick
                <Input
                  type="number" min={1} max={8} className="w-16"
                  value={g.count ?? 1}
                  onChange={(e) => patch(i, { count: Math.max(1, Number(e.target.value) || 1) })}
                />
              </label>
              <button
                onClick={() => setGroups((gs) => gs.filter((_, x) => x !== i))}
                className="rounded-lg border border-zinc-700 p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
                title="Remove this question"
              >
                <Trash2 size={14} />
              </button>
            </div>

            {/* only asked when an earlier answer unlocks it */}
            {earlierKeys(i).length > 0 && (
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                <span>Only ask if</span>
                <select
                  value={Object.keys(g.when || {})[0] || ""}
                  onChange={(e) => {
                    const k = e.target.value;
                    patch(i, { when: k ? { [k]: Object.values(g.when || {})[0] || "" } : undefined });
                  }}
                  className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs"
                >
                  <option value="">always ask</option>
                  {earlierKeys(i).map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
                {Object.keys(g.when || {})[0] && (
                  <Input
                    className="w-48 text-xs"
                    placeholder="is… e.g. Combo"
                    value={String(Object.values(g.when || {})[0] ?? "")}
                    onChange={(e) => patch(i, { when: { [Object.keys(g.when || {})[0]]: e.target.value } })}
                  />
                )}
              </div>
            )}

            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
              <span>Choices from</span>
              <select
                value={g.from_category || ""}
                onChange={(e) => patch(i, { from_category: e.target.value || undefined })}
                className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs"
                title="Read live from a menu category, so it can never offer something you don't stock"
              >
                <option value="">a fixed list below</option>
                {categories.map((c) => <option key={c} value={c}>the {c} category</option>)}
              </select>
            </div>

            {!g.from_category && (
              <div className="space-y-1.5">
                {(g.choices || []).map((c, ci) => (
                  <div key={ci} className="flex flex-wrap items-center gap-2">
                    <Input
                      className="flex-1 min-w-[140px]"
                      placeholder="Choice, e.g. Full Meal"
                      value={c.name}
                      onChange={(e) => patchChoice(i, ci, { name: e.target.value })}
                    />
                    <Input
                      type="number" className="w-28" placeholder="Price"
                      value={c.price ?? ""}
                      onChange={(e) => patchChoice(i, ci, { price: e.target.value === "" ? undefined : Number(e.target.value) })}
                      title="Total price for this choice — replaces the item's price"
                    />
                    <Input
                      type="number" className="w-24" placeholder="+Extra"
                      value={c.delta ?? ""}
                      onChange={(e) => patchChoice(i, ci, { delta: e.target.value === "" ? undefined : Number(e.target.value) })}
                      title="Added on top of the item's price"
                    />
                    {c.sample && <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">sample</span>}
                    <button
                      onClick={() => patch(i, { choices: (g.choices || []).filter((_, y) => y !== ci) })}
                      className="rounded-lg border border-zinc-700 p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
                <Btn variant="ghost" className="px-2 py-1 text-xs" onClick={() => patch(i, { choices: [...(g.choices || []), { name: "" }] })}>
                  <span className="flex items-center gap-1"><Plus size={12} /> choice</span>
                </Btn>
              </div>
            )}
          </div>
        ))}
      </div>

      {err && <div className="mt-2 text-xs text-red-400">{err}</div>}
      <div className="mt-3 flex items-center gap-2">
        <Btn onClick={save}>{saving ? "Saving…" : "Save questions"}</Btn>
        <span className="text-xs text-zinc-500">
          {groups.length} question{groups.length === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  );
}
