import { useEffect, useState } from "react";
import { api } from "../config/api";
import { Card, PageHeader, Btn, Input, Empty } from "../components/ui";

export default function Settings() {
  const [config, setConfig] = useState<any | null>(null);
  const [saved, setSaved] = useState("");

  useEffect(() => {
    api.get("/api/settings").then((r) => setConfig(r.data)).catch(() => {});
  }, []);

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

  return (
    <div className="max-w-3xl">
      <PageHeader title="Settings" subtitle={`${config.name} · ${config.slug}`} />

      <Card className="mb-5 p-5">
        <SectionTitle title="Restaurant info" saved={saved === "basic_info"} onSave={() => saveSection("basic_info", config.basic_info)} />
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Name"><Input value={bi.name || ""} onChange={(e) => upd("basic_info", { name: e.target.value })} /></Field>
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
        </div>
        <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-zinc-400">House policies (the bot answers from these — empty = "team will confirm")</h3>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Alcohol"><Input value={bi.policies?.alcohol || ""} onChange={(e) => upd("basic_info", { policies: { ...bi.policies, alcohol: e.target.value } })} /></Field>
          <Field label="Shisha"><Input value={bi.policies?.shisha || ""} onChange={(e) => upd("basic_info", { policies: { ...bi.policies, shisha: e.target.value } })} /></Field>
          <Field label="Kids"><Input value={bi.policies?.kids || ""} onChange={(e) => upd("basic_info", { policies: { ...bi.policies, kids: e.target.value } })} /></Field>
          <Field label="Smoking"><Input value={bi.policies?.smoking || ""} onChange={(e) => upd("basic_info", { policies: { ...bi.policies, smoking: e.target.value } })} /></Field>
        </div>
      </Card>

      <Card className="mb-5 p-5">
        <SectionTitle title="AI host" saved={saved === "ai"} onSave={() => saveSection("ai", config.ai)} />
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Bot name"><Input value={ai.name || ""} onChange={(e) => upd("ai", { name: e.target.value })} /></Field>
          <Field label="Chat enabled">
            <Toggle on={!!ai.chat_enabled} onClick={() => upd("ai", { chat_enabled: !ai.chat_enabled })} />
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
      </Card>

      <Card className="mb-5 p-5">
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
      </Card>

      <Card className="p-5">
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
      </Card>
    </div>
  );
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
