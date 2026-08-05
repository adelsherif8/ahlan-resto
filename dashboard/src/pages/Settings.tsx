import { useEffect, useState } from "react";
import { api } from "../config/api";
import { Card, PageHeader, Btn, Input, Empty } from "../components/ui";

export default function Settings() {
  const [config, setConfig] = useState<any | null>(null);
  const [saved, setSaved] = useState("");
  const [suggested, setSuggested] = useState<any[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [tab, setTab] = useState(() => window.location.hash.replace("#", "") || "info");

  useEffect(() => {
    api.get("/api/settings").then((r) => setConfig(r.data)).catch(() => {});
    api.get("/api/settings/suggested-faqs").then((r) => setSuggested(r.data)).catch(() => {});
  }, []);

  async function actOnSuggestion(id: string, action: "approve" | "dismiss") {
    const { data } = await api.post(`/api/settings/suggested-faqs/${id}`, { action, answer: answers[id] || undefined }).catch((e) => {
      alert(e.response?.data?.error || "Failed");
      return { data: null };
    });
    if (data) {
      setSuggested((xs) => xs.filter((s) => s.id !== id));
      if (data.faqs) setConfig((c: any) => ({ ...c, faqs: data.faqs }));
    }
  }

  if (!config) return <Empty text="Loading…" />;

  async function saveSection(section: string, value: any) {
    await api.put(`/api/settings/${section}`, value);
    setSaved(section);
    setTimeout(() => setSaved(""), 2000);
  }

  const bi = config.basic_info || {};
  const ai = config.ai || {};
  const rp = config.reservation_policy || {};
  const dep = rp.deposits || {};

  function upd(section: string, patch: any) {
    setConfig((c: any) => ({ ...c, [section]: { ...c[section], ...patch } }));
  }

  const SECTIONS: [string, string][] = [
    ["info", "Restaurant info"],
    ["charges", "Charges"],
    ["ai", "AI host"],
    ["branding", "Branding"],
    ["menu", "Menu display"],
    ...(((bi.restaurant_type || "fine") !== "casual" ? [["reservations", "Reservations"]] : []) as [string, string][]),
    ["offers", "Offers & specials"],
    ["pos", "POS"],
    ["faqs", "FAQs"],
  ];

  return (
    <div className="flex max-w-5xl gap-6">
      <aside className="w-44 shrink-0">
        <div className="sticky top-0 space-y-0.5 pt-1">
          {SECTIONS.map(([k, label]) => (
            <button key={k} onClick={() => { setTab(k); window.location.hash = k; }}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs transition ${tab === k ? "bg-zinc-800 font-semibold text-zinc-100" : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"}`}>
              {label}
              {k === "faqs" && suggested.length > 0 && (
                <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">{suggested.length}</span>
              )}
            </button>
          ))}
        </div>
      </aside>
      <div className="min-w-0 max-w-3xl flex-1">
      <PageHeader title="Settings" subtitle={`${config.name} · ${config.slug}`} />

      {tab === "info" && <Card className="p-5">
        <SectionTitle title="Restaurant info" saved={saved === "basic_info"} onSave={() => saveSection("basic_info", config.basic_info)} />
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Name"><Input value={bi.name || ""} onChange={(e) => upd("basic_info", { name: e.target.value })} /></Field>
          <Field label="Restaurant type (sets the whole experience)">
            <div className="flex gap-1 rounded-full bg-zinc-900 p-1">
              {([["casual", "Fast casual"], ["fine", "Fine dining"]] as const).map(([k, label]) => (
                <button key={k} type="button"
                  onClick={() => upd("basic_info", { restaurant_type: k })}
                  className={`rounded-full px-3 py-1 text-xs transition ${(bi.restaurant_type || "fine") === k ? "bg-zinc-700 text-zinc-100" : "text-zinc-500"}`}>
                  {label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Instagram"><Input value={bi.contact?.instagram || ""} onChange={(e) => upd("basic_info", { contact: { ...bi.contact, instagram: e.target.value } })} /></Field>
          <Field label="Address"><Input value={bi.address || ""} onChange={(e) => upd("basic_info", { address: e.target.value })} /></Field>
          <Field label="Phone"><Input value={bi.contact?.phone || ""} onChange={(e) => upd("basic_info", { contact: { ...bi.contact, phone: e.target.value } })} /></Field>
          <Field label="Dress code"><Input value={bi.dress_code || ""} onChange={(e) => upd("basic_info", { dress_code: e.target.value })} /></Field>
          <Field label="Parking"><Input value={bi.parking || ""} onChange={(e) => upd("basic_info", { parking: e.target.value })} /></Field>
          <Field label="Google Maps link" full><Input value={bi.google_maps || ""} onChange={(e) => upd("basic_info", { google_maps: e.target.value })} placeholder="https://maps.google.com/?q=…" /></Field>
          <Field label="Vibe / atmosphere (the bot describes this to guests)" full>
            <Input value={bi.vibe || ""} onChange={(e) => upd("basic_info", { vibe: e.target.value })} placeholder="e.g. Dim lights, music at talking volume, terrace for late nights…" />
          </Field>
        </div>
        <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-zinc-400">Services</h3>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Dine-in"><Toggle on={bi.services?.dine_in !== false} onClick={() => upd("basic_info", { services: { ...bi.services, dine_in: bi.services?.dine_in === false } })} /></Field>
          <Field label="Pickup"><Toggle on={!!bi.services?.pickup} onClick={() => upd("basic_info", { services: { ...bi.services, pickup: !bi.services?.pickup } })} /></Field>
          <Field label="Delivery"><Toggle on={!!bi.services?.delivery} onClick={() => upd("basic_info", { services: { ...bi.services, delivery: !bi.services?.delivery } })} /></Field>
          <Field label="Table numbers (dine-in asks the table)">
            <Toggle on={bi.services?.table_numbers !== false} onClick={() => upd("basic_info", { services: { ...bi.services, table_numbers: bi.services?.table_numbers === false } })} />
          </Field>
        </div>
        <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-zinc-400">House policies (the bot answers from these — empty = "team will confirm")</h3>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Alcohol"><Input value={bi.policies?.alcohol || ""} onChange={(e) => upd("basic_info", { policies: { ...bi.policies, alcohol: e.target.value } })} /></Field>
          <Field label="Shisha"><Input value={bi.policies?.shisha || ""} onChange={(e) => upd("basic_info", { policies: { ...bi.policies, shisha: e.target.value } })} /></Field>
          <Field label="Kids"><Input value={bi.policies?.kids || ""} onChange={(e) => upd("basic_info", { policies: { ...bi.policies, kids: e.target.value } })} /></Field>
          <Field label="Smoking"><Input value={bi.policies?.smoking || ""} onChange={(e) => upd("basic_info", { policies: { ...bi.policies, smoking: e.target.value } })} /></Field>
        </div>
      </Card>}

      {tab === "charges" && <Card className="p-5">
        <SectionTitle title="Charges (applied to every bill & receipt)" saved={saved === "payments"} onSave={() => saveSection("payments", config.payments)} />
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="VAT %">
            <Input type="number" value={pctVal(config.payments?.tax)} placeholder="14"
              onChange={(e) => upd("payments", { tax: pctIn(e.target.value) })} />
          </Field>
          <Field label="Service charge % (dine-in only)">
            <Input type="number" value={pctVal(config.payments?.service_charge)} placeholder="12"
              onChange={(e) => upd("payments", { service_charge: pctIn(e.target.value) })} />
          </Field>
          <Field label={`Delivery fee (${config.payments?.currency || "EGP"})`}>
            <Input type="number" value={config.payments?.delivery_fee ?? ""} placeholder="30"
              onChange={(e) => upd("payments", { delivery_fee: e.target.value === "" ? 0 : Number(e.target.value) })} />
          </Field>
        </div>
      </Card>}

      {tab === "ai" && <Card className="p-5">
        <SectionTitle title="AI host" saved={saved === "ai"} onSave={() => saveSection("ai", config.ai)} />
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Bot name"><Input value={ai.name || ""} onChange={(e) => upd("ai", { name: e.target.value })} /></Field>
          <Field label="Chat enabled">
            <Toggle on={!!ai.chat_enabled} onClick={() => upd("ai", { chat_enabled: !ai.chat_enabled })} />
          </Field>
          <Field label="Voice quality (cost vs premium tone)">
            <div className="flex gap-1 rounded-full bg-zinc-900 p-1">
              {([["auto", "Auto (smart when it matters)"], ["smart", "Always premium"]] as const).map(([k, label]) => (
                <button key={k} type="button"
                  onClick={() => upd("ai", { voice_mode: k })}
                  className={`rounded-full px-3 py-1 text-xs transition ${(ai.voice_mode || "auto") === k ? "bg-zinc-700 text-zinc-100" : "text-zinc-500"}`}>
                  {label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Personality" full>
            <Input value={ai.personality || ""} onChange={(e) => upd("ai", { personality: e.target.value })} />
          </Field>
          <Field label="Greeting" full>
            <Input value={ai.greeting || ""} onChange={(e) => upd("ai", { greeting: e.target.value })} />
          </Field>
          <Field label="Reservations via bot">
            <Toggle on={!!ai.reservations_enabled} onClick={() => upd("ai", { reservations_enabled: !ai.reservations_enabled })} />
          </Field>
          <Field label="Orders via bot">
            <Toggle on={!!ai.orders_enabled} onClick={() => upd("ai", { orders_enabled: !ai.orders_enabled })} />
          </Field>
        </div>
      </Card>}

      {tab === "branding" && <Card className="p-5">
        <SectionTitle title="Branding (your colors & logo — applied across the dashboard)" saved={saved === "basic_info_brand"} onSave={() => saveSection("basic_info", config.basic_info)} />
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Brand color">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={bi.brand?.primary || "#f59e0b"}
                onChange={(e) => upd("basic_info", { brand: { ...bi.brand, primary: e.target.value } })}
                className="h-9 w-14 cursor-pointer rounded-lg border border-zinc-700 bg-zinc-900"
              />
              <Input value={bi.brand?.primary || ""} placeholder="#ea0000" className="w-28"
                onChange={(e) => upd("basic_info", { brand: { ...bi.brand, primary: e.target.value } })} />
            </div>
          </Field>
          <Field label="Logo URL (square works best)">
            <Input value={bi.brand?.logo_url || ""} placeholder="https://…/logo.png"
              onChange={(e) => upd("basic_info", { brand: { ...bi.brand, logo_url: e.target.value } })} />
          </Field>
          <Field label="Theme">
            <div className="flex gap-1 rounded-full bg-zinc-900 p-1">
              {(["dark", "light"] as const).map((m) => (
                <button key={m} type="button"
                  onClick={() => upd("basic_info", { brand: { ...bi.brand, mode: m } })}
                  className={`rounded-full px-3 py-1 text-xs capitalize transition ${(bi.brand?.mode || "dark") === m ? "bg-zinc-700 text-zinc-100" : "text-zinc-500"}`}>
                  {m}
                </button>
              ))}
            </div>
          </Field>
          {bi.brand?.logo_url && (
            <Field label="Preview">
              <img src={bi.brand.logo_url} alt="logo" className="h-10 w-10 rounded-lg bg-white object-contain p-0.5" />
            </Field>
          )}
        </div>
        <p className="mt-2 text-xs text-zinc-500">Save, then refresh — the sidebar, buttons and highlights take your color.</p>
      </Card>}

      {tab === "menu" && <Card className="p-5">
        <SectionTitle title="Menu display (how the bot shows the menu)" saved={saved === "menu_config"} onSave={() => saveSection("menu_config", config.menu_config || {})} />
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="When a guest asks for the menu">
            <div className="flex gap-1 rounded-full bg-zinc-900 p-1">
              {([["list", "Tappable list"], ["text", "One message"], ["pdf", "PDF"]] as const).map(([k, label]) => (
                <button key={k} type="button"
                  onClick={() => upd("menu_config", { display: k })}
                  className={`rounded-full px-3 py-1 text-xs transition ${((config.menu_config || {}).display || "list") === k ? "bg-zinc-700 text-zinc-100" : "text-zinc-500"}`}>
                  {label}
                </button>
              ))}
            </div>
          </Field>
          {(config.menu_config || {}).display === "pdf" && (
            <Field label="Menu PDF URL (your designed menu)">
              <Input value={(config.menu_config || {}).pdf_url || ""} placeholder="https://…/menu.pdf"
                onChange={(e) => upd("menu_config", { pdf_url: e.target.value })} />
            </Field>
          )}
        </div>
        <p className="mt-2 text-xs text-zinc-500">List: categories the guest taps. One message: the whole menu as text. PDF: your designed menu file, sent as a document.</p>
      </Card>}

      {tab === "reservations" && <Card className="p-5">
        <SectionTitle title="Reservation policy" saved={saved === "reservation_policy"} onSave={() => saveSection("reservation_policy", config.reservation_policy)} />
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Slot size (min)"><Input type="number" value={rp.slot_minutes || 30} onChange={(e) => upd("reservation_policy", { slot_minutes: Number(e.target.value) })} /></Field>
          <Field label="Grace period (min)"><Input type="number" value={rp.grace_minutes || 15} onChange={(e) => upd("reservation_policy", { grace_minutes: Number(e.target.value) })} /></Field>
          <Field label="Max party online"><Input type="number" value={rp.max_party_online || 8} onChange={(e) => upd("reservation_policy", { max_party_online: Number(e.target.value) })} /></Field>
          <Field label="Deposits enabled">
            <Toggle on={!!dep.enabled} onClick={() => upd("reservation_policy", { deposits: { ...dep, enabled: !dep.enabled } })} />
          </Field>
          <Field label="Deposit / person (EGP)">
            <Input type="number" value={dep.per_person || 0} onChange={(e) => upd("reservation_policy", { deposits: { ...dep, per_person: Number(e.target.value) } })} />
          </Field>
          <Field label="From party size">
            <Input type="number" value={dep.applies_from_party || 1} onChange={(e) => upd("reservation_policy", { deposits: { ...dep, applies_from_party: Number(e.target.value) } })} />
          </Field>
        </div>
      </Card>}

      {tab === "offers" && <Card className="mb-5 p-5">
        <SectionTitle title="Offers (the bot may mention ONLY these)" saved={saved === "ai_offers"} onSave={() => saveSection("ai", config.ai)} />
        <div className="space-y-2">
          {(ai.offers || []).map((o: string, i: number) => (
            <div key={i} className="flex gap-2">
              <Input className="flex-1" value={o} onChange={(e) => {
                const offers = [...(ai.offers || [])]; offers[i] = e.target.value; upd("ai", { offers });
              }} />
              <Btn variant="danger" className="px-2.5 py-1 text-xs" onClick={() => upd("ai", { offers: (ai.offers || []).filter((_: any, j: number) => j !== i) })}>✕</Btn>
            </div>
          ))}
          <Btn variant="ghost" onClick={() => upd("ai", { offers: [...(ai.offers || []), ""] })}>+ Add offer</Btn>
        </div>
      </Card>}

      {tab === "offers" && <Card className="p-5">
        <SectionTitle title="Tonight's specials (the bot pitches these — auto-expire on the date)" saved={saved === "ai_specials"} onSave={() => saveSection("ai", config.ai)} />
        <div className="space-y-2">
          {(ai.specials || []).map((s: any, i: number) => (
            <div key={i} className="flex gap-2">
              <Input className="flex-1" placeholder="e.g. Lamb Ouzi for two — 950 EGP, tonight only" value={s?.text || ""} onChange={(e) => {
                const specials = [...(ai.specials || [])]; specials[i] = { ...specials[i], text: e.target.value }; upd("ai", { specials });
              }} />
              <Input type="date" className="w-40" title="Last day it's valid (empty = until removed)" value={s?.until || ""} onChange={(e) => {
                const specials = [...(ai.specials || [])]; specials[i] = { ...specials[i], until: e.target.value || undefined }; upd("ai", { specials });
              }} />
              <Btn variant="danger" className="px-2.5 py-1 text-xs" onClick={() => upd("ai", { specials: (ai.specials || []).filter((_: any, j: number) => j !== i) })}>✕</Btn>
            </div>
          ))}
          <Btn variant="ghost" onClick={() => upd("ai", { specials: [...(ai.specials || []), { text: "" }] })}>+ Add special</Btn>
        </div>
      </Card>}

      {tab === "pos" && <Card className="p-5">
        <SectionTitle title="POS cashiers (PIN switch on the register; ★ manager approves discounts)" saved={saved === "pos"} onSave={() => saveSection("pos", config.pos || {})} />
        <div className="space-y-2">
          {((config.pos?.cashiers || []) as any[]).map((c: any, i: number) => (
            <div key={i} className="flex gap-2">
              <Input className="flex-1" placeholder="Name" value={c.name || ""} onChange={(e) => {
                const cashiers = [...(config.pos?.cashiers || [])]; cashiers[i] = { ...c, name: e.target.value }; upd("pos", { cashiers });
              }} />
              <Input className="w-24" placeholder="PIN" value={c.pin || ""} onChange={(e) => {
                const cashiers = [...(config.pos?.cashiers || [])]; cashiers[i] = { ...c, pin: e.target.value.replace(/[^0-9]/g, "").slice(0, 6) }; upd("pos", { cashiers });
              }} />
              <button type="button" title="Manager — can approve discounts"
                onClick={() => { const cashiers = [...(config.pos?.cashiers || [])]; cashiers[i] = { ...c, manager: !c.manager }; upd("pos", { cashiers }); }}
                className={`rounded-lg border px-2.5 text-sm ${c.manager ? "border-amber-400/60 text-amber-300" : "border-zinc-700 text-zinc-500"}`}>★</button>
              <Btn variant="danger" className="px-2.5 py-1 text-xs" onClick={() => upd("pos", { cashiers: (config.pos?.cashiers || []).filter((_: any, j: number) => j !== i) })}>✕</Btn>
            </div>
          ))}
          <Btn variant="ghost" onClick={() => upd("pos", { cashiers: [...(config.pos?.cashiers || []), { name: "", pin: "", manager: false }] })}>+ Add cashier</Btn>
          <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-zinc-400">Loyalty & guest screen</h3>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Reward every N orders (0 = off)">
              <Input type="number" value={config.pos?.loyalty_every ?? ""} placeholder="6"
                onChange={(e) => upd("pos", { loyalty_every: e.target.value === "" ? 0 : Number(e.target.value) })} />
            </Field>
            <Field label="The reward">
              <Input value={config.pos?.loyalty_reward || ""} placeholder="Free drink"
                onChange={(e) => upd("pos", { loyalty_reward: e.target.value })} />
            </Field>
            <Field label="WhatsApp number (guest-screen QR)">
              <Input value={config.pos?.wa_number || ""} placeholder="201515066123"
                onChange={(e) => upd("pos", { wa_number: e.target.value })} />
            </Field>
          </div>
          <p className="text-xs text-zinc-500">Empty list = open register (anyone can type a name). With cashiers configured, switching needs the PIN and discounts need a ★ manager's PIN.</p>
        </div>
      </Card>}

      {tab === "faqs" && suggested.length > 0 && (
        <Card className="mb-5 border-amber-500/40 p-5">
          <h2 className="mb-1 text-sm font-semibold text-amber-300">Suggested by the bot — guests asked, it couldn't answer</h2>
          <p className="mb-4 text-xs text-zinc-500">Write the answer and approve → becomes a FAQ the bot uses instantly.</p>
          <div className="space-y-4">
            {suggested.map((s) => (
              <div key={s.id} className="rounded-xl border border-zinc-800 bg-zinc-900 p-3">
                <div className="text-sm font-medium">{s.question}</div>
                {s.context && <div className="mt-0.5 text-xs text-zinc-500">guest said: "{s.context}"</div>}
                <div className="mt-2 flex gap-2">
                  <Input className="flex-1" placeholder="Your answer…" value={answers[s.id] || ""} onChange={(e) => setAnswers({ ...answers, [s.id]: e.target.value })} />
                  <Btn className="px-3 py-1.5 text-xs" onClick={() => actOnSuggestion(s.id, "approve")}>Approve</Btn>
                  <Btn variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => actOnSuggestion(s.id, "dismiss")}>Dismiss</Btn>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === "faqs" && <Card className="p-5">
        <SectionTitle title="FAQs (the bot answers from these)" saved={saved === "faqs"} onSave={() => saveSection("faqs", config.faqs)} />
        <div className="space-y-3">
          {(config.faqs || []).map((f: any, i: number) => (
            <div key={i} className="grid gap-2 md:grid-cols-2">
              <Input value={f.q} placeholder="Question" onChange={(e) => {
                const faqs = [...config.faqs]; faqs[i] = { ...f, q: e.target.value }; setConfig({ ...config, faqs });
              }} />
              <div className="flex gap-2">
                <Input className="flex-1" value={f.a} placeholder="Answer" onChange={(e) => {
                  const faqs = [...config.faqs]; faqs[i] = { ...f, a: e.target.value }; setConfig({ ...config, faqs });
                }} />
                <Btn variant="danger" className="px-2.5 py-1 text-xs" onClick={() => setConfig({ ...config, faqs: config.faqs.filter((_: any, j: number) => j !== i) })}>✕</Btn>
              </div>
            </div>
          ))}
          <Btn variant="ghost" onClick={() => setConfig({ ...config, faqs: [...(config.faqs || []), { q: "", a: "" }] })}>+ Add FAQ</Btn>
        </div>
      </Card>}
      </div>
    </div>
  );
}

// charges are stored as fractions (0.14) but edited as percentages (14)
function pctVal(v: any): string {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return "";
  return String(n > 1 ? n : Math.round(n * 1000) / 10);
}
function pctIn(s: string): number {
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n / 100; // the field is always a percentage
}

function SectionTitle({ title, onSave, saved }: { title: string; onSave: () => void; saved: boolean }) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <h2 className="text-sm font-semibold text-zinc-200">{title}</h2>
      <div className="flex items-center gap-2">
        {saved && <span className="text-xs text-emerald-400">Saved ✓</span>}
        <Btn variant="ghost" className="px-3 py-1.5 text-xs" onClick={onSave}>Save</Btn>
      </div>
    </div>
  );
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <label className={`block ${full ? "md:col-span-2" : ""}`}>
      <span className="mb-1 block text-xs text-zinc-500">{label}</span>
      {children}
    </label>
  );
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative h-6 w-11 rounded-full transition ${on ? "bg-emerald-500" : "bg-zinc-700"}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}
