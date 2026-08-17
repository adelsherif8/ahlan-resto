import { useMemo, useState } from "react";
import { Plus, Trash2, AlertTriangle, ChevronUp, ChevronDown, MessageCircle, ClipboardPaste } from "lucide-react";
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

// Most option groups in a restaurant are the same handful of questions. Typing "Regular /
// Large" from scratch on every drink is busywork, so the common shapes are one click and
// then editable — a starting point, never a lock-in.
const TEMPLATES: { id: string; label: string; build: (cats: string[]) => Group }[] = [
  { id: "size", label: "Size", build: () => ({ key: "size", label: "What size?", required: true, choices: [{ name: "Regular" }, { name: "Large" }] }) },
  { id: "drink", label: "Choice of drink", build: (cats) => ({
      key: "drink", label: "Which drink?", required: true,
      from_category: cats.find((c) => /drink|beverage|مشروب/i.test(c)),
      choices: cats.find((c) => /drink|beverage|مشروب/i.test(c)) ? undefined : [{ name: "Coca-Cola" }, { name: "Sprite" }, { name: "Water" }],
    }) },
  { id: "extras", label: "Extras (multi-pick)", build: () => ({ key: "extras", label: "Anything extra?", required: false, count: 1, choices: [{ name: "Extra cheese", delta: 15 }, { name: "Bacon", delta: 25 }] }) },
  { id: "sauce", label: "Sauce", build: () => ({ key: "sauce", label: "Which sauce?", required: true, choices: [{ name: "BBQ" }, { name: "Ranch" }, { name: "Hot" }] }) },
  { id: "doneness", label: "Doneness", build: () => ({ key: "doneness", label: "How would you like it cooked?", required: true, choices: [{ name: "Medium" }, { name: "Medium well" }, { name: "Well done" }] }) },
  { id: "bread", label: "Bread", build: () => ({ key: "bread", label: "Which bread?", required: true, choices: [{ name: "Brioche" }, { name: "Baladi" }, { name: "No bread" }] }) },
  { id: "blank", label: "Blank question", build: () => blank() },
];

export default function OptionsEditor({
  item, categories, menuItems = [], onSaved,
}: { item: any; categories: string[]; menuItems?: any[]; onSaved: () => void }) {
  const [groups, setGroups] = useState<Group[]>(() => JSON.parse(JSON.stringify(item.options || [])));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [preview, setPreview] = useState(false);
  const [pasteFor, setPasteFor] = useState<number | null>(null);

  const patch = (i: number, p: Partial<Group>) =>
    setGroups((gs) => gs.map((g, x) => (x === i ? { ...g, ...p } : g)));
  const patchChoice = (gi: number, ci: number, p: Partial<Choice>) =>
    setGroups((gs) => gs.map((g, x) => x !== gi ? g
      : { ...g, choices: (g.choices || []).map((c, y) => (y === ci ? { ...c, ...p, sample: undefined } : c)) }));
  const move = (i: number, dir: -1 | 1) =>
    setGroups((gs) => {
      const n = [...gs]; const j = i + dir;
      if (j < 0 || j >= n.length) return gs;
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });

  // menu items, grouped, for the "add from your menu" picker
  const byCategory = useMemo(() => {
    const m: Record<string, any[]> = {};
    for (const it of menuItems) { (m[it.category] = m[it.category] || []).push(it); }
    return m;
  }, [menuItems]);

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

  const earlier = (i: number) => groups.slice(0, i).filter((g) => (g.key || g.label));
  const hasSample = groups.some((g) => g.sample || (g.choices || []).some((c) => c.sample));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-zinc-100">Ordering questions</div>
          <p className="text-xs text-zinc-500">Asked in order, one at a time, before this item can be ordered.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setPreview((v) => !v)}
            className={`flex cursor-pointer items-center gap-1.5 rounded-xl border px-3 py-2 text-xs ${preview ? "border-zinc-400 text-zinc-100" : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"}`}>
            <MessageCircle size={13} /> Preview
          </button>
          {/* templates instead of a blank box: the common questions are one pick */}
          <select value="" aria-label="Add a question"
            onChange={(e) => {
              const t = TEMPLATES.find((x) => x.id === e.target.value);
              if (t) setGroups((gs) => [...gs, t.build(categories)]);
              e.target.value = "";
            }}
            className="cursor-pointer rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-200">
            <option value="">+ Add question…</option>
            {TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
      </div>

      {preview && <Preview groups={groups} item={item} byCategory={byCategory} />}

      {hasSample && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-500 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            Values marked <b>sample</b> were filled in as placeholders — guests will be charged
            them. Replace with your real prices; editing a field clears the flag.
          </span>
        </div>
      )}

      {groups.length === 0 && (
        <p className="py-3 text-xs text-zinc-500">No questions — guests can order this item straight away.</p>
      )}

      <div className="space-y-3">
        {groups.map((g, i) => (
          <div key={i} className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="flex shrink-0 items-center gap-0.5">
                <button onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move question up"
                  className="cursor-pointer rounded p-0.5 text-zinc-600 hover:text-zinc-200 disabled:opacity-30"><ChevronUp size={14} /></button>
                <button onClick={() => move(i, 1)} disabled={i === groups.length - 1} aria-label="Move question down"
                  className="cursor-pointer rounded p-0.5 text-zinc-600 hover:text-zinc-200 disabled:opacity-30"><ChevronDown size={14} /></button>
              </span>
              <Input
                className="min-w-[160px] flex-1"
                placeholder="Question, e.g. Sandwich or combo"
                value={g.label}
                onChange={(e) => patch(i, { label: e.target.value, sample: undefined })}
              />
              <label className="flex items-center gap-1 text-xs text-zinc-400" title="How many they must pick — 4 for a bundle of 4 sandwiches">
                pick
                <Input type="number" min={1} max={8} className="w-16" value={g.count ?? 1}
                  onChange={(e) => patch(i, { count: Math.max(1, Number(e.target.value) || 1) })} />
              </label>
              <button onClick={() => setGroups((gs) => gs.filter((_, x) => x !== i))}
                className="cursor-pointer rounded-lg border border-zinc-700 p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-red-500"
                title="Remove this question">
                <Trash2 size={14} />
              </button>
            </div>

            {/* conditional questions: both halves are pickers now. Typing the answer by
                hand meant one typo silently made the question never appear. */}
            {earlier(i).length > 0 && (
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                <span>Only ask if</span>
                <select
                  value={Object.keys(g.when || {})[0] || ""}
                  onChange={(e) => {
                    const k = e.target.value;
                    patch(i, { when: k ? { [k]: Object.values(g.when || {})[0] || "" } : undefined });
                  }}
                  className="cursor-pointer rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs">
                  <option value="">always ask</option>
                  {earlier(i).map((e2) => {
                    const k = (e2.key || e2.label || "").toLowerCase().replace(/[^a-z0-9]+/g, "_");
                    return <option key={k} value={k}>{e2.label || k}</option>;
                  })}
                </select>
                {Object.keys(g.when || {})[0] && (() => {
                  const k = Object.keys(g.when || {})[0];
                  const src = earlier(i).find((e2) => (e2.key || e2.label || "").toLowerCase().replace(/[^a-z0-9]+/g, "_") === k);
                  const opts = (src?.choices || []).map((c) => c.name).filter(Boolean);
                  const cur = String(Object.values(g.when || {})[0] ?? "");
                  return opts.length ? (
                    <select value={cur} onChange={(e) => patch(i, { when: { [k]: e.target.value } })}
                      className="cursor-pointer rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs">
                      <option value="">is…</option>
                      {opts.map((o) => <option key={o} value={o}>is “{o}”</option>)}
                    </select>
                  ) : (
                    <Input className="w-48 text-xs" placeholder="is… e.g. Combo" value={cur}
                      onChange={(e) => patch(i, { when: { [k]: e.target.value } })} />
                  );
                })()}
              </div>
            )}

            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
              <span>Choices from</span>
              <select
                value={g.from_category || ""}
                onChange={(e) => patch(i, { from_category: e.target.value || undefined })}
                className="cursor-pointer rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs"
                title="Read live from a menu category, so it can never offer something you don't stock">
                <option value="">a fixed list below</option>
                {categories.map((c) => <option key={c} value={c}>the {c} category — kept in sync</option>)}
              </select>
              {g.from_category && <span className="text-zinc-500">Every available item in {g.from_category} is offered automatically.</span>}
            </div>

            {!g.from_category && (
              <div className="space-y-1.5">
                <div className="flex gap-2 px-1 text-xs text-zinc-500">
                  <span className="flex-1">Choice</span>
                  <span className="w-28 text-center" title="Total price for this choice — replaces the item's price">Price instead</span>
                  <span className="w-24 text-center" title="Added on top of the item's price">Add to price</span>
                  <span className="w-8" />
                </div>
                {(g.choices || []).map((c, ci) => (
                  <div key={ci} className="flex flex-wrap items-center gap-2">
                    <Input className="min-w-[140px] flex-1" placeholder="Choice, e.g. Full Meal" value={c.name}
                      onChange={(e) => patchChoice(i, ci, { name: e.target.value })} />
                    <Input type="number" className="w-28" placeholder="—" value={c.price ?? ""}
                      onChange={(e) => patchChoice(i, ci, { price: e.target.value === "" ? undefined : Number(e.target.value) })} />
                    <Input type="number" className="w-24" placeholder="—" value={c.delta ?? ""}
                      onChange={(e) => patchChoice(i, ci, { delta: e.target.value === "" ? undefined : Number(e.target.value) })} />
                    {c.sample && <span className="rounded bg-amber-500 px-1.5 py-0.5 text-xs font-semibold text-amber-950">sample</span>}
                    <button onClick={() => patch(i, { choices: (g.choices || []).filter((_, y) => y !== ci) })}
                      aria-label={`Remove ${c.name || "choice"}`}
                      className="cursor-pointer rounded-lg border border-zinc-700 p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-red-500">
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {/* the choices are usually already ON the menu — pick them, don't retype
                      them, and take their real price while you're at it */}
                  {menuItems.length > 0 && (
                    <select value="" aria-label="Add a choice from your menu"
                      onChange={(e) => {
                        const hit = menuItems.find((m) => String(m.id) === e.target.value);
                        if (hit) patch(i, { choices: [...(g.choices || []), { name: hit.name, price: Number(hit.price) || undefined }] });
                        e.target.value = "";
                      }}
                      className="cursor-pointer rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200">
                      <option value="">+ from your menu…</option>
                      {Object.entries(byCategory).map(([cat, list]) => (
                        <optgroup key={cat} label={cat}>
                          {list.map((m: any) => <option key={m.id} value={m.id}>{m.name} — {m.price}</option>)}
                        </optgroup>
                      ))}
                    </select>
                  )}
                  <Btn variant="ghost" className="px-2 py-1 text-xs" onClick={() => patch(i, { choices: [...(g.choices || []), { name: "" }] })}>
                    <span className="flex items-center gap-1"><Plus size={12} /> custom choice</span>
                  </Btn>
                  <button onClick={() => setPasteFor(pasteFor === i ? null : i)}
                    className="flex cursor-pointer items-center gap-1 rounded-lg border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800">
                    <ClipboardPaste size={12} /> paste a list
                  </button>
                </div>

                {pasteFor === i && (
                  <PasteList onDone={(names) => {
                    patch(i, { choices: [...(g.choices || []).filter((c) => c.name.trim()), ...names.map((n) => ({ name: n }))] });
                    setPasteFor(null);
                  }} onCancel={() => setPasteFor(null)} />
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {err && <div className="mt-2 text-xs text-red-500">{err}</div>}
      <div className="mt-4 flex items-center gap-2 border-t border-zinc-800 pt-3">
        <Btn onClick={save} disabled={saving}>{saving ? "Saving…" : "Save questions"}</Btn>
        <span className="text-xs text-zinc-500">{groups.length} question{groups.length === 1 ? "" : "s"}</span>
      </div>
    </div>
  );
}

// One per line — how anyone actually has this list already, in a note or a supplier email.
function PasteList({ onDone, onCancel }: { onDone: (names: string[]) => void; onCancel: () => void }) {
  const [text, setText] = useState("");
  const names = text.split("\n").map((t) => t.trim()).filter(Boolean);
  return (
    <div className="rounded-lg border border-zinc-700 p-2">
      <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={4}
        placeholder={"One choice per line:\nCoca-Cola\nSprite\nFanta"}
        className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 outline-none" />
      <div className="mt-1.5 flex items-center gap-2">
        <Btn className="px-2 py-1 text-xs" onClick={() => onDone(names)} disabled={!names.length}>Add {names.length || ""}</Btn>
        <button onClick={onCancel} className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-300">cancel</button>
      </div>
    </div>
  );
}

// What the guest actually gets asked. Options are the easiest thing to get subtly wrong —
// a condition that never fires, a question with one choice — and none of that is visible
// from the form alone.
function Preview({ groups, item, byCategory }: { groups: Group[]; item: any; byCategory: Record<string, any[]> }) {
  const live = groups.filter((g) => g.label && (g.from_category || (g.choices || []).some((c) => c.name.trim())));
  return (
    <div className="mb-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
      <div className="mb-2 text-xs font-semibold text-zinc-400">The guest is asked</div>
      {live.length === 0 ? (
        <p className="text-xs text-zinc-500">Nothing yet — they'd order {item.name} straight away.</p>
      ) : (
        <div className="space-y-2">
          {live.map((g, i) => {
            const fromCat = g.from_category ? (byCategory[g.from_category] || []).filter((m: any) => m.available !== false) : null;
            const list = fromCat ? fromCat.map((m: any) => ({ name: m.name, price: Number(m.price) })) : (g.choices || []).filter((c) => c.name.trim());
            const cond = Object.entries(g.when || {})[0];
            return (
              <div key={i} className="rounded-lg bg-zinc-950/60 px-2.5 py-2">
                <div className="text-xs text-zinc-200">
                  {g.label}
                  {cond && <span className="text-zinc-500"> — only if {cond[0]} is “{cond[1]}”</span>}
                </div>
                <div className="mt-0.5 text-xs text-zinc-400">
                  {list.slice(0, 6).map((c: any) => (
                    <span key={c.name} className="mr-2 inline-block">
                      • {c.name}
                      {c.price != null ? ` (${c.price})` : c.delta ? ` (+${c.delta})` : ""}
                    </span>
                  ))}
                  {list.length > 6 && <span className="text-zinc-600">+{list.length - 6} more</span>}
                  {list.length === 0 && <span className="text-amber-600">no choices yet — this question won't be asked</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
