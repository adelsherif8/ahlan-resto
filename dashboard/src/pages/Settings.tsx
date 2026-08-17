import { useEffect, useState } from "react";
import DeliveryMap from "./DeliveryMap";
import { api } from "../config/api";
import { Card, PageHeader, Btn, Input, Empty } from "../components/ui";

export default function Settings() {
  const [config, setConfig] = useState<any | null>(null);
  const [saved, setSaved] = useState("");
  const [suggested, setSuggested] = useState<any[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [tab, setTab] = useState(() => window.location.hash.replace("#", "") || "info");
  const [byoCatalog, setByoCatalog] = useState<any[]>([]);
  const [byoUrl, setByoUrl] = useState("");

  // The ingredient list comes from the flows service, which owns the 3D catalog —
  // a second copy here would drift the moment a layer is added.
  useEffect(() => {
    if (tab !== "builder" || byoCatalog.length) return;
    api.post("/api/settings/builder-preview", {})
      .then((r) => { setByoCatalog(r.data?.catalog || []); setByoUrl(r.data?.url || ""); })
      .catch(() => {});
  }, [tab]);


  // A settings page with 16 separate Save buttons and no dirty tracking loses work
  // silently: edit a section, switch tab or navigate away, and it's gone with nothing said.
  const [saved0, setSaved0] = useState<any | null>(null);   // last known server state
  useEffect(() => {
    api.get("/api/settings").then((r) => { setConfig(r.data); setSaved0(r.data); }).catch(() => {});
    api.get("/api/settings/suggested-faqs").then((r) => setSuggested(r.data)).catch(() => {});
  }, []);

  const SECTION_OF_TAB: Record<string, string[]> = {
    info: ["basic_info"], charges: ["payments"], ai: ["ai"], branding: ["basic_info"],
    menu: ["menu_config"], delivery: ["basic_info"], builder: ["menu_config"],
    reservations: ["reservation_policy"], offers: ["ai"], pos: ["pos"], promos: ["pos"], faqs: ["faqs"],
  };
  const isDirty = (section: string) =>
    !!saved0 && JSON.stringify(config?.[section] ?? null) !== JSON.stringify(saved0?.[section] ?? null);
  const dirtySections = saved0
    ? ["basic_info", "hours", "payments", "ai", "menu_config", "pos", "faqs", "reservation_policy", "sections"].filter(isDirty)
    : [];
  const tabDirty = (t: string) => (SECTION_OF_TAB[t] || []).some(isDirty);

  // the browser-level guard, for a refresh or a closed tab
  useEffect(() => {
    if (!dirtySections.length) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirtySections.length]);

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
    try {
      await api.put(`/api/settings/${section}`, value);
      setSaved0((s0: any) => ({ ...(s0 || {}), [section]: JSON.parse(JSON.stringify(value)) }));
      setSaved(section);
      setTimeout(() => setSaved(""), 2000);
    } catch (e: any) {
      alert(e?.response?.data?.error || "Couldn't save — nothing was changed on the server.");
    }
  }

  const bi = config.basic_info || {};
  const ai = config.ai || {};
  const rp = config.reservation_policy || {};
  const dep = rp.deposits || {};

  function upd(section: string, patch: any) {
    setConfig((c: any) => ({ ...c, [section]: { ...c[section], ...patch } }));
  }

  // Delivery coverage lives inside basic_info.delivery (saved via the basic_info section).
  const dv = bi.delivery || {};
  const dzones: any[] = dv.zones || [];
  const setDelivery = (patch: any) => upd("basic_info", { delivery: { ...dv, ...patch } });
  const setZone = (i: number, patch: any) => setDelivery({ zones: dzones.map((z, j) => (j === i ? { ...z, ...patch } : z)) });
  const pr = dv.pricing || {};
  const setPricing = (patch: any) => setDelivery({ pricing: { ...pr, ...patch } });
  const branchesCfg: any[] = Array.isArray(bi.branches) ? bi.branches : [];



  const SECTIONS: [string, string][] = [
    ["info", "Restaurant info"],
    ["charges", "Charges"],
    ["ai", "AI host"],
    ["branding", "Branding"],
    ["menu", "Menu display"],
    ["delivery", "Delivery"],
    ["builder", "Build your own"],
    ...(((bi.restaurant_type || "fine") !== "casual" ? [["reservations", "Reservations"]] : []) as [string, string][]),
    ["offers", "Offers & specials"],
    ["pos", "POS"],
    ["promos", "Promotions"],
    ["faqs", "FAQs"],
  ];

  return (
    <div className="flex max-w-5xl gap-6">
      <aside className="w-44 shrink-0">
        <div className="sticky top-0 space-y-0.5 pt-1">
          {SECTIONS.map(([k, label]) => (
            <button key={k} onClick={() => { setTab(k); window.location.hash = k; }}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs transition ${tab === k ? "bg-zinc-800 font-semibold text-zinc-100" : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"}`}>
              <span className="flex items-center gap-1.5">
                {label}
                {tabDirty(k) && <span title="Unsaved changes in this section" className="h-1.5 w-1.5 rounded-full bg-amber-500" />}
              </span>
              {k === "faqs" && suggested.length > 0 && (
                <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-xs font-bold text-amber-300">{suggested.length}</span>
              )}
            </button>
          ))}
        </div>
      </aside>
      <div className="min-w-0 max-w-3xl flex-1">
      <PageHeader title="Settings" subtitle={`${config.name} · ${config.slug}`} />

      {dirtySections.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-amber-500 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <b>Unsaved changes</b> in {dirtySections.map((x) => x.replace("_", " ")).join(", ")} — each section has its own Save button.
        </div>
      )}

      {tab === "info" && <Card className="p-5">
        <SectionTitle title="Restaurant info" saved={saved === "basic_info"} onSave={() => saveSection("basic_info", config.basic_info)}  dirty={isDirty("basic_info")} />
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
        <SectionTitle title="Charges (applied to every bill & receipt)" saved={saved === "payments"} onSave={() => saveSection("payments", config.payments)}  dirty={isDirty("payments")} />
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
        <SectionTitle title="AI host" saved={saved === "ai"} onSave={() => saveSection("ai", config.ai)}  dirty={isDirty("ai")} />
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
          <Field label="Answer waiting guests within (min) — 0 = no target">
            <Input type="number" min={0} max={240} value={ai.sla_minutes ?? 0}
              onChange={(e) => upd("ai", { sla_minutes: Math.max(0, Number(e.target.value) || 0) })} />
          </Field>
          <Field label="Compact messages (one bubble per reply — cuts Meta's Oct-2026 per-message fees ~2×)">
            <Toggle on={!!ai.compact_messages} onClick={() => upd("ai", { compact_messages: !ai.compact_messages })} />
          </Field>
          <Field label="First-timer suggestions (⭐ up to 3 dishes, comma-separated)">
            <Input value={(ai.suggest_dishes || []).join(", ")} onChange={(e) => upd("ai", { suggest_dishes: e.target.value.split(",").map((x: string) => x.trim()).filter(Boolean).slice(0, 3) })} />
          </Field>
          <Field label="Ask dine-in/pickup/delivery FIRST (before the menu)">
            <Toggle on={!!ai.ask_type_first} onClick={() => upd("ai", { ask_type_first: !ai.ask_type_first })} />
          </Field>
          <Field label="Smart pickup timing (asks when they're coming; fresh-start nudge)">
            <Toggle on={!!ai.pickup_smart_timing} onClick={() => upd("ai", { pickup_smart_timing: !ai.pickup_smart_timing })} />
          </Field>
          <Field label="Orders via bot">
            <Toggle on={!!ai.orders_enabled} onClick={() => upd("ai", { orders_enabled: !ai.orders_enabled })} />
          </Field>
        </div>
        <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-zinc-400">Automations (the bot acts on its own — every switch is yours)</h3>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Abandoned-order recovery (nudge a forgotten draft)">
            <div className="flex items-center gap-2">
              <Toggle on={ai.automations?.recovery?.enabled !== false} onClick={() => upd("ai", { automations: { ...ai.automations, recovery: { ...ai.automations?.recovery, enabled: ai.automations?.recovery?.enabled === false } } })} />
              <Input type="number" className="w-20" title="Minutes of silence before the nudge" value={ai.automations?.recovery?.delay_min ?? 45}
                onChange={(e) => upd("ai", { automations: { ...ai.automations, recovery: { ...ai.automations?.recovery, delay_min: Number(e.target.value) || 45 } } })} />
              <span className="text-xs text-zinc-500">min</span>
            </div>
          </Field>
          <Field label="Post-order upsell ping (one drink/side offer)">
            <div className="flex items-center gap-2">
              <Toggle on={ai.automations?.upsell?.enabled !== false} onClick={() => upd("ai", { automations: { ...ai.automations, upsell: { ...ai.automations?.upsell, enabled: ai.automations?.upsell?.enabled === false } } })} />
              <Input type="number" className="w-20" title="Minutes after the order lands" value={ai.automations?.upsell?.delay_min ?? 5}
                onChange={(e) => upd("ai", { automations: { ...ai.automations, upsell: { ...ai.automations?.upsell, delay_min: Number(e.target.value) || 5 } } })} />
              <span className="text-xs text-zinc-500">min</span>
            </div>
          </Field>
          <Field label="Google-review ask (~1h after arrival; unhappy guests skipped)">
            <Toggle on={ai.automations?.review_ask?.enabled !== false} onClick={() => upd("ai", { automations: { ...ai.automations, review_ask: { ...ai.automations?.review_ask, enabled: ai.automations?.review_ask?.enabled === false } } })} />
          </Field>
          <Field label="Google reviews link (required for the ask)">
            <Input value={ai.google_reviews_url || ""} placeholder="https://g.page/r/…/review"
              onChange={(e) => upd("ai", { google_reviews_url: e.target.value })} />
          </Field>
          <Field label="Reorder reminders (silent regulars) — awaiting Meta template approval">
            <div className="flex items-center gap-2">
              <Toggle on={!!ai.automations?.reorder?.enabled} onClick={() => upd("ai", { automations: { ...ai.automations, reorder: { ...ai.automations?.reorder, enabled: !ai.automations?.reorder?.enabled } } })} />
              <Input type="number" className="w-20" title="Days of silence" value={ai.automations?.reorder?.days ?? 10}
                onChange={(e) => upd("ai", { automations: { ...ai.automations, reorder: { ...ai.automations?.reorder, days: Number(e.target.value) || 10 } } })} />
              <span className="text-xs text-zinc-500">days · sends start once the template is approved</span>
            </div>
          </Field>
        </div>
      </Card>}

      {tab === "branding" && <Card className="p-5">
        <SectionTitle title="Branding (your colors & logo — applied across the dashboard)" saved={saved === "basic_info"} onSave={() => saveSection("basic_info", config.basic_info)}  dirty={isDirty("basic_info")} />
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
        <SectionTitle title="Menu display (how the bot shows the menu)" saved={saved === "menu_config"} onSave={() => saveSection("menu_config", config.menu_config || {})}  dirty={isDirty("menu_config")} />
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

        <UpsellSettings config={config} upd={upd} />
      </Card>}

      {tab === "delivery" && <Card className="p-5">
        <SectionTitle title="Delivery coverage" saved={saved === "basic_info"} onSave={() => saveSection("basic_info", config.basic_info)}  dirty={isDirty("basic_info")} />
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Delivery enabled"><Toggle on={dv.enabled !== false} onClick={() => setDelivery({ enabled: dv.enabled === false })} /></Field>
          <Field label="Paused right now (kitchen slammed → pickup only)"><Toggle on={!!dv.paused} onClick={() => setDelivery({ paused: !dv.paused })} /></Field>
          <Field label="Show ETAs to guests"><Toggle on={dv.eta_enabled !== false} onClick={() => setDelivery({ eta_enabled: dv.eta_enabled === false })} /></Field>
          <Field label="Rush-hour padding (min added to every ETA)"><Input type="number" value={dv.rush_pad_min ?? ""} onChange={(e) => setDelivery({ rush_pad_min: Number(e.target.value) || 0 })} placeholder="0" /></Field>
          <Field label="Minimum order for delivery (EGP, 0 = none)"><Input type="number" value={dv.min_order ?? ""} onChange={(e) => setDelivery({ min_order: Number(e.target.value) || 0 })} placeholder="0" /></Field>
          <Field label="Free delivery over (EGP, 0 = off)"><Input type="number" value={dv.free_over ?? ""} onChange={(e) => setDelivery({ free_over: Number(e.target.value) || 0 })} placeholder="0" /></Field>
          <Field label="Delivery hours — from (optional, e.g. 12:00)"><Input value={dv.hours?.open || ""} onChange={(e) => setDelivery({ hours: { ...(dv.hours || {}), open: e.target.value } })} placeholder="always" /></Field>
          <Field label="Delivery hours — until (e.g. 23:00)"><Input value={dv.hours?.close || ""} onChange={(e) => setDelivery({ hours: { ...(dv.hours || {}), close: e.target.value } })} placeholder="always" /></Field>
          <Field label="What to say for an area you don't cover" full>
            <Input value={dv.uncovered_message || ""} onChange={(e) => setDelivery({ uncovered_message: e.target.value })} placeholder="We don't deliver there yet 🙏 but pickup's always ready." />
          </Field>
        </div>

        <div className="mt-5 mb-2 flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Zones you deliver to</div>
          <Btn variant="ghost" onClick={() => setDelivery({ zones: [...dzones, { area: "", aliases: [], fee: 0, eta_min: 0 }] })}>+ Add zone</Btn>
        </div>
        <div className="space-y-2">
          {dzones.length === 0 && <p className="text-xs text-zinc-500">No zones yet — add the areas you deliver to and their fees. If the guest's area isn't listed, the bot honestly says you don't deliver there and offers pickup (never invents a fee).</p>}
          {dzones.map((z, i) => (
            <div key={i} className="grid grid-cols-12 items-center gap-2 rounded-lg border border-zinc-800 p-2">
              <div className="col-span-4"><Input value={z.area || ""} onChange={(e) => setZone(i, { area: e.target.value })} placeholder="Area name (e.g. Tagamoa)" /></div>
              <div className="col-span-4"><Input value={(z.aliases || []).join(", ")} onChange={(e) => setZone(i, { aliases: e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean) })} placeholder="aliases: التجمع, new cairo" /></div>
              <div className="col-span-2"><Input type="number" value={z.fee ?? ""} onChange={(e) => setZone(i, { fee: Number(e.target.value) || 0 })} placeholder="fee" /></div>
              <div className="col-span-1"><Input type="number" value={z.eta_min ?? ""} onChange={(e) => setZone(i, { eta_min: Number(e.target.value) || 0 })} placeholder="min" /></div>
              <button className="col-span-1 text-zinc-500 hover:text-red-400" onClick={() => setDelivery({ zones: dzones.filter((_, j) => j !== i) })} title="Remove">✕</button>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-zinc-500">Aliases let guests say the area in Arabic, English or Franco (comma-separated). ETA in minutes. The bot quotes exact fees and the order bill matches.</p>

        {/* HOW THE FEE IS COMPUTED — per restaurant */}
        <div className="mt-6 mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">How the delivery fee is calculated</div>
        <div className="mb-3 flex gap-1">
          {([["zone_fixed", "Fixed per zone", "each zone above has its own fee"], ["flat_in_zone", "One flat fee", "same fee anywhere inside your area"], ["distance", "By distance", "base fee up to N km from the branch, then per extra km"]] as const).map(([k, l, d]) => (
            <button key={k} type="button" onClick={() => setPricing({ mode: k })} title={d}
              className={`flex-1 rounded-lg px-2 py-2 text-xs font-medium ${(pr.mode || "zone_fixed") === k ? "bg-zinc-200 text-zinc-900" : "bg-zinc-800/70 text-zinc-400"}`}>{l}</button>
          ))}
        </div>
        {(pr.mode || "zone_fixed") === "flat_in_zone" && (
          <div className="grid gap-3 md:grid-cols-3"><Field label="Flat delivery fee (EGP)"><Input type="number" value={pr.flat_fee ?? ""} onChange={(e) => setPricing({ flat_fee: Number(e.target.value) || 0 })} placeholder="40" /></Field></div>
        )}
        {pr.mode === "distance" && (
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="Base fee (EGP)"><Input type="number" value={pr.base_fee ?? ""} onChange={(e) => setPricing({ base_fee: Number(e.target.value) || 0 })} placeholder="50" /></Field>
            <Field label="…covers up to (km)"><Input type="number" step="0.5" value={pr.base_km ?? ""} onChange={(e) => setPricing({ base_km: Number(e.target.value) || 0 })} placeholder="5" /></Field>
            <Field label="Then per extra km (EGP)"><Input type="number" value={pr.per_km ?? ""} onChange={(e) => setPricing({ per_km: Number(e.target.value) || 0 })} placeholder="6" /></Field>
            <Field label="Partial km">
              <select className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200" value={pr.round_km || "up"} onChange={(e) => setPricing({ round_km: e.target.value })}>
                <option value="up">round up (5.2 → 6 km)</option><option value="nearest">round to nearest</option><option value="exact">charge exact (5.2 → 51.2)</option>
              </select>
            </Field>
            <p className="text-xs text-zinc-500 md:col-span-4">Example with these numbers: {Number(pr.base_km) || 5} km or less → {Number(pr.base_fee) || 50} EGP · {(Number(pr.base_km) || 5) + 1} km → {(Number(pr.base_fee) || 50) + (Number(pr.per_km) || 6)} EGP · {(Number(pr.base_km) || 5) + 5} km → {(Number(pr.base_fee) || 50) + 5 * (Number(pr.per_km) || 6)} EGP. Distance is measured from the branch pin (straight line × 1.3 road factor, free — no maps API). Needs the branch pin on the map below.</p>
          </div>
        )}

        {/* THE MAP */}
        <div className="mt-6 mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-400">Coverage map — draw where you deliver</div>
        <p className="text-xs text-zinc-500">The bot checks every address against this boundary (exact, no guessing). Landmarks and districts help it place addresses guests type ("Point 90", "Narges 4") without any paid maps service.</p>
        <DeliveryMap
          zones={dzones}
          branches={branchesCfg}
          landmarks={Array.isArray(dv.landmarks) ? dv.landmarks : []}
          pricing={pr}
          onChange={(patch) => {
            if (patch.branches) upd("basic_info", { branches: patch.branches, delivery: { ...dv, ...(patch.zones ? { zones: patch.zones } : {}), ...(patch.landmarks ? { landmarks: patch.landmarks } : {}) } });
            else setDelivery({ ...(patch.zones ? { zones: patch.zones } : {}), ...(patch.landmarks ? { landmarks: patch.landmarks } : {}) });
          }}
        />

        <div className="mt-5 grid gap-3 md:grid-cols-1">
          <Field label="Areas you're often asked about but DON'T cover (comma-separated — the bot says no straight away instead of asking for a pin)" full>
            <Input value={(dv.outside_areas || []).join(", ")} onChange={(e) => setDelivery({ outside_areas: e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean) })} placeholder="maadi, المعادي, nasr city, مدينة نصر, zamalek, heliopolis (leave empty for the Cairo default list)" />
          </Field>
        </div>
      </Card>}

      {tab === "builder" && <Card className="p-5">
        <SectionTitle title="Build your own (3D sandwich builder)" saved={saved === "menu_config"} onSave={() => saveSection("menu_config", config.menu_config || {})}  dirty={isDirty("menu_config")} />
        {(() => {
          const byo = (config.menu_config || {}).build_your_own || {};
          const layers = byo.layers || {};
          const setByo = (patch: any) => upd("menu_config", { build_your_own: { ...byo, ...patch } });
          const setLayer = (key: string, v: string) => {
            const next = { ...layers };
            if (v === "") delete next[key];               // no price = not offered
            else next[key] = Number(v);
            setByo({ layers: next });
          };
          const priced = Object.values(layers).filter((v) => Number.isFinite(Number(v))).length;
          const hasProtein = byoCatalog.some((c) => c.category === "protein" && Number.isFinite(Number(layers[c.key])));
          return (
            <>
              <div className="grid gap-3 md:grid-cols-3">
                <Field label="Builder switched on">
                  <Toggle on={byo.enabled === true} onClick={() => setByo({ enabled: !(byo.enabled === true) })} />
                </Field>
                <Field label="Base price (charged before any layer)">
                  <Input type="number" value={byo.base_price ?? 0} onChange={(e) => setByo({ base_price: Number(e.target.value) })} />
                </Field>
                <Field label="Max of any one layer">
                  <Input type="number" value={byo.max_per_layer ?? 3} onChange={(e) => setByo({ max_per_layer: Number(e.target.value) })} />
                </Field>
              </div>

              <p className="mt-4 mb-2 text-xs text-zinc-500">
                What customers can stack, and what each one costs. Leave a price blank to keep that ingredient
                out of the builder entirely. Prices are what the kitchen charges — the total is always worked
                out here on the server, never in the customer's browser.
              </p>
              {byoCatalog.length === 0 && <p className="text-xs text-zinc-500">Loading ingredients…</p>}
              {["bread", "protein", "cheese", "veggie", "sauce"].map((cat) => {
                const inCat = byoCatalog.filter((c) => c.category === cat);
                if (!inCat.length) return null;
                const CAT_NAME: Record<string, string> = { bread: "Buns & wraps", protein: "Protein", cheese: "Cheese", veggie: "Veggies", sauce: "Sauces" };
                return (
                  <div key={cat} className="mb-4">
                    <div className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-500">{CAT_NAME[cat]}</div>
                    <div className="grid gap-3 md:grid-cols-4">
                      {inCat.map((c) => (
                        <Field key={c.key} label={c.name}>
                          <Input type="number" placeholder="not offered"
                            value={layers[c.key] ?? ""} onChange={(e) => setLayer(c.key, e.target.value)} />
                        </Field>
                      ))}
                    </div>
                  </div>
                );
              })}

              {byo.enabled === true && !hasProtein && (
                <p className="mt-3 text-xs text-amber-400">
                  The builder stays off until the beef patty has a price — a burger builder with no protein
                  priced would quote numbers nobody set.
                </p>
              )}
              <div className="mt-3 flex items-center gap-3">
                <button type="button"
                  onClick={() => { if (byoUrl) window.open(byoUrl, "_blank"); }}
                  disabled={!byoUrl}
                  className="rounded-xl px-4 py-2 text-xs font-bold"
                  style={{ backgroundColor: "var(--accent)", color: "var(--accent-contrast)" }}>
                  Open the builder
                </button>
                <span className="text-xs text-zinc-500">{priced} ingredient{priced === 1 ? "" : "s"} priced and on offer.</span>
              </div>
            </>
          );
        })()}

        <div className="mt-6 border-t border-zinc-800 pt-5">
          <SectionTitle title="Button wording" saved={saved === "ai"} onSave={() => saveSection("ai", config.ai || {})}  dirty={isDirty("ai")} />
          <p className="mb-2 text-xs text-zinc-500">
            The tappable buttons the bot sends. Change the words to your own voice — the bot still
            recognises a tap either way. Leave blank for the default.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {([["build_your_own", "Build a burger 🍔"], ["same_as_last", "Same as last time 🔁"],
               ["browse_menu", "Browse Menu"], ["order_now", "Order now"]] as const).map(([k, dflt]) => (
              <Field key={k} label={dflt}>
                <Input placeholder={dflt} maxLength={24}
                  value={((config.ai || {}).labels || {})[k] || ""}
                  onChange={(e) => upd("ai", { labels: { ...((config.ai || {}).labels || {}), [k]: e.target.value } })} />
              </Field>
            ))}
          </div>
        </div>

        {/* These used to be four English lines hardcoded in the Chats page — every
            restaurant inherited the same voice and none could change a word of it. */}
        <div className="mt-6 border-t border-zinc-800 pt-5">
          <SectionTitle title="Staff quick replies" saved={saved === "ai"} onSave={() => saveSection("ai", config.ai || {})}  dirty={isDirty("ai")} />
          <p className="mb-2 text-xs text-zinc-500">
            One-tap replies staff send from the Chats page — your words, your language.
            Use <code className="rounded bg-zinc-800 px-1">{"{name}"}</code> for the guest's name
            and <code className="rounded bg-zinc-800 px-1">{"{order}"}</code> for their latest order code;
            both are filled in before sending, and a line is skipped if the value is missing.
          </p>
          <SnippetsEditor
            value={(config.ai || {}).snippets || []}
            onChange={(next: string[]) => upd("ai", { snippets: next })}
          />
        </div>
      </Card>}

      {tab === "reservations" && <Card className="p-5">
        <SectionTitle title="Reservation policy" saved={saved === "reservation_policy"} onSave={() => saveSection("reservation_policy", config.reservation_policy)}  dirty={isDirty("reservation_policy")} />
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
        <SectionTitle title="Offers (the bot may mention ONLY these)" saved={saved === "ai"} onSave={() => saveSection("ai", config.ai)}  dirty={isDirty("ai")} />
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
        <SectionTitle title="Tonight's specials (the bot pitches these — auto-expire on the date)" saved={saved === "ai"} onSave={() => saveSection("ai", config.ai)}  dirty={isDirty("ai")} />
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
        <SectionTitle title="POS cashiers (PIN switch on the register; ★ manager approves discounts)" saved={saved === "pos"} onSave={() => saveSection("pos", config.pos || {})}  dirty={isDirty("pos")} />
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
          <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-zinc-400">Kitchen stations (route ticket lines by category)</h3>
          <div className="space-y-2">
            {((config.pos?.stations || []) as any[]).map((st: any, i: number) => (
              <div key={i} className="flex gap-2">
                <Input className="w-32" placeholder="Grill" value={st.name || ""} onChange={(e) => {
                  const stations = [...(config.pos?.stations || [])]; stations[i] = { ...st, name: e.target.value }; upd("pos", { stations });
                }} />
                <Input className="flex-1" placeholder="Categories, comma-separated — Burgers, Wraps" value={st.cats || ""} onChange={(e) => {
                  const stations = [...(config.pos?.stations || [])]; stations[i] = { ...st, cats: e.target.value }; upd("pos", { stations });
                }} />
                <Btn variant="danger" className="px-2.5 py-1 text-xs" onClick={() => upd("pos", { stations: (config.pos?.stations || []).filter((_: any, j: number) => j !== i) })}>✕</Btn>
              </div>
            ))}
            <Btn variant="ghost" onClick={() => upd("pos", { stations: [...(config.pos?.stations || []), { name: "", cats: "" }] })}>+ Add station</Btn>
            <p className="text-xs text-zinc-500">POS orders stamp each line with its station; the Orders board gets per-station filter chips (a screen by the fryer picks "Fryer" and sees only its lines).</p>
          </div>
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
            <Field label="Order-number style">
              <div className="flex gap-1 rounded-full bg-zinc-900 p-1">
                {([["random", "Random (O-7KQ2)"], ["daily", "Daily sequence (JS-041)"]] as const).map(([k, label]) => (
                  <button key={k} type="button"
                    onClick={() => upd("pos", { order_code: { ...(config.pos?.order_code || {}), mode: k } })}
                    className={`rounded-full px-3 py-1 text-xs transition ${((config.pos?.order_code || {}).mode || "random") === k ? "bg-zinc-700 text-zinc-100" : "text-zinc-500"}`}>
                    {label}
                  </button>
                ))}
              </div>
            </Field>
            {(config.pos?.order_code || {}).mode === "daily" && (
              <Field label="Code prefix (your brand, resets nightly)">
                <Input value={(config.pos?.order_code || {}).prefix || ""} placeholder="JS"
                  onChange={(e) => upd("pos", { order_code: { ...(config.pos?.order_code || {}), prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) } })} />
              </Field>
            )}
            <Field label="Branch-switch PIN (register lock)">
              <Input value={config.pos?.branch_pin || ""} placeholder="e.g. 4321"
                onChange={(e) => upd("pos", { branch_pin: e.target.value.replace(/[^0-9]/g, "").slice(0, 6) })} />
            </Field>
            <Field label="WhatsApp number (guest-screen QR)">
              <Input value={config.pos?.wa_number || ""} placeholder="201515066123"
                onChange={(e) => upd("pos", { wa_number: e.target.value })} />
            </Field>
          </div>
          <p className="text-xs text-zinc-500">Empty list = open register (anyone can type a name). With cashiers configured, switching needs the PIN and discounts need a ★ manager's PIN.</p>
        </div>
      </Card>}

      {tab === "promos" && <Card className="p-5">
        <SectionTitle title="Promotions (the POS applies these automatically at checkout)" saved={saved === "pos"} onSave={() => saveSection("pos", config.pos || {})}  dirty={isDirty("pos")} />
        <div className="space-y-3">
          {((config.pos?.promos || []) as any[]).map((p: any, i: number) => {
            const set = (patch: any) => { const promos = [...(config.pos?.promos || [])]; promos[i] = { ...p, ...patch }; upd("pos", { promos }); };
            return (
              <div key={i} className="rounded-xl border border-zinc-800 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <select value={p.type || "bogo"} onChange={(e) => set({ type: e.target.value })}
                    className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100">
                    <option value="bogo">Buy N get M free</option>
                    <option value="item_pct">% off an item</option>
                    <option value="order_pct">% off orders over X</option>
                  </select>
                  <button type="button" onClick={() => set({ active: p.active === false })}
                    className={`rounded-full px-2.5 py-1 text-xs ${p.active !== false ? "bg-emerald-500 text-emerald-950" : "bg-zinc-800 text-zinc-500"}`}>
                    {p.active !== false ? "active" : "paused"}
                  </button>
                  <Btn variant="danger" className="ml-auto px-2.5 py-1 text-xs" onClick={() => upd("pos", { promos: (config.pos?.promos || []).filter((_: any, j: number) => j !== i) })}>✕</Btn>
                </div>
                {(p.type || "bogo") === "bogo" && (
                  <div className="grid gap-2 md:grid-cols-4">
                    <Field label="Buy item (exact name)"><Input value={p.buy_item || ""} placeholder="Iconic Meal" onChange={(e) => set({ buy_item: e.target.value })} /></Field>
                    <Field label="Buy qty"><Input type="number" value={p.buy_qty ?? 2} onChange={(e) => set({ buy_qty: Number(e.target.value) || 2 })} /></Field>
                    <Field label="Get item free (exact name)"><Input value={p.get_item || ""} placeholder="Loaded Fries" onChange={(e) => set({ get_item: e.target.value })} /></Field>
                    <Field label="Free qty"><Input type="number" value={p.get_qty ?? 1} onChange={(e) => set({ get_qty: Number(e.target.value) || 1 })} /></Field>
                  </div>
                )}
                {p.type === "item_pct" && (
                  <div className="grid gap-2 md:grid-cols-2">
                    <Field label="Item (exact name)"><Input value={p.item || ""} onChange={(e) => set({ item: e.target.value })} /></Field>
                    <Field label="% off"><Input type="number" value={p.pct ?? 10} onChange={(e) => set({ pct: Number(e.target.value) || 0 })} /></Field>
                  </div>
                )}
                {p.type === "order_pct" && (
                  <div className="grid gap-2 md:grid-cols-2">
                    <Field label="Order minimum (EGP)"><Input type="number" value={p.min_total ?? 500} onChange={(e) => set({ min_total: Number(e.target.value) || 0 })} /></Field>
                    <Field label="% off"><Input type="number" value={p.pct ?? 10} onChange={(e) => set({ pct: Number(e.target.value) || 0 })} /></Field>
                  </div>
                )}
              </div>
            );
          })}
          <Btn variant="ghost" onClick={() => upd("pos", { promos: [...(config.pos?.promos || []), { type: "bogo", buy_qty: 2, get_qty: 1, active: true }] })}>+ Add promotion</Btn>
          <p className="text-xs text-zinc-500">Applied by CODE at the register — the discount line carries the promo name so the Z report shows exactly what was given away.</p>
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
        <SectionTitle title="FAQs (the bot answers from these)" saved={saved === "faqs"} onSave={() => saveSection("faqs", config.faqs)}  dirty={isDirty("faqs")} />
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

function SectionTitle({ title, onSave, saved, dirty }: { title: string; onSave: () => void; saved: boolean; dirty?: boolean }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-2">
      <h2 className="text-sm font-semibold text-zinc-200">{title}</h2>
      <div className="flex items-center gap-2">
        {saved && <span className="text-xs text-emerald-500">Saved ✓</span>}
        {!saved && dirty && <span className="text-xs font-medium text-amber-600">unsaved</span>}
        <Btn variant={dirty ? "primary" : "ghost"} className="px-3 py-1.5 text-xs" onClick={onSave}>
          {dirty ? "Save changes" : "Save"}
        </Btn>
      </div>
    </div>
  );
}

// ADD-ONS on the confirm screen — code picks real items, never invented (menu_config.upsell)
function UpsellSettings({ config, upd }: { config: any; upd: (section: string, patch: any) => void }) {
  const mc = config.menu_config || {};
  const up = mc.upsell || {};
  const setUp = (patch: any) => upd("menu_config", { upsell: { ...up, ...patch } });
  return (
    <>
      <div className="mt-6 mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">Add-on suggestions ("🍟 Add a side / dessert / drink?")</div>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Suggest add-ons"><Toggle on={up.enabled !== false} onClick={() => setUp({ enabled: up.enabled === false })} /></Field>
        <Field label="Where">
          <select className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200" value={up.placement || "confirm"} onChange={(e) => setUp({ placement: e.target.value })}>
            <option value="confirm">On the confirm screen (above the Confirm button)</option>
            <option value="payment">With the payment question</option>
          </select>
        </Field>
        <Field label="Auto-pick when no list below"><Toggle on={up.auto !== false} onClick={() => setUp({ auto: up.auto === false })} /></Field>
        <Field label="Your own list (comma-separated dish names — up to 3 shown; empty = auto: best side / dessert / drink that fits the order)" full>
          <Input value={(up.items || []).join(", ")} onChange={(e) => setUp({ items: e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean) })} placeholder="Loaded Fries, Triple Chocolate Chip Cookie, Milkshake Chocolate" />
        </Field>
      </div>
      <p className="mt-2 text-xs text-zinc-500">Only real menu items at their real prices, once per order, in the guest's language. Auto mode skips a side/drink when the order already has a combo, and never suggests sauces, kids' items or dishes with option questions.</p>
    </>
  );
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <label className={`block ${full ? "md:col-span-2" : ""}`}>
      <span className="mb-1 block text-xs text-zinc-500">{label}</span>
      <span className="block [&_input]:w-full [&_select]:w-full [&_textarea]:w-full">{children}</span>
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

// Free-form list editor for the staff quick replies. Kept deliberately dumb: add, edit,
// remove, reorder by position in the list. Empty list = the Chats page falls back to a
// neutral built-in set, so a restaurant that never opens this screen still has something.
function SnippetsEditor({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const rows = value.length ? value : [""];
  const set = (i: number, v: string) => {
    const next = [...rows];
    next[i] = v;
    onChange(next.filter((x, n) => x.trim() || n < next.length - 1));
  };
  return (
    <div className="space-y-2">
      {rows.map((s, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input className="flex-1" maxLength={300} placeholder="e.g. Ahlan {name}! How can we help?"
            value={s} onChange={(e) => set(i, e.target.value)} />
          <button type="button" onClick={() => onChange(rows.filter((_, n) => n !== i))}
            aria-label="Remove this quick reply"
            className="cursor-pointer rounded-lg border border-zinc-700 px-2 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200">
            remove
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...rows.filter((x) => x.trim()), ""])}
        className="cursor-pointer rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800">
        + Add a quick reply
      </button>
    </div>
  );
}
