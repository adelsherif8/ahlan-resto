// WhatsApp Flow — the native delivery-address form (docs/WA-FLOWS-PLAN.md).
//
// A Flow is a real form inside the chat: labelled fields, required markers, and the
// completion comes back as JSON (interactive.type "nfm_reply"). The order logic never
// learns that a Flow exists: the completion is turned into exactly the one-line address
// a careful guest would have typed, in the labelled shape parseAddress() already reads.
//
//   nfm_reply.response_json → {street, area, building, floor, apartment, landmark}
//     → "Street 9, building 14, floor 3, apartment 7, near Metro Market, Maadi"
//     → the normal INGEST → RESPOND path, as a guest text event
//
// No endpoint, no encryption: a Flow whose Footer action is `complete` returns the form
// values in the chat. endpoint_uri / data_api_version / public keys are only for
// data_exchange Flows, which we are not building.
import { parseAddress } from "./address.js";

export const FLOW_JSON_VERSION = "7.3";
export const ADDRESS_SCREEN = "ADDRESS";

// Two Flows, one per script (labels are nouns; the guest types in whatever they like).
// Franco guests get the English form. Versioned in the name: a published Flow's JSON may
// not be editable, so a label change is a new name (…-v2) and a fresh create.
export const flowName = (slug, lang) => `${slug}-address-${lang === "ar" ? "ar" : "en"}-v1`;

// Meta caps: TextInput label ≤ 20 chars, CTA ≤ 30 chars and no emoji, Footer label ≤ 35.
const LABELS = {
  en: { title: "Delivery address", street: "Street", area: "Area", building: "Building", floor: "Floor", apartment: "Apartment", landmark: "Landmark (optional)", footer: "Confirm address", cta: "Enter address" },
  ar: { title: "عنوان التوصيل", street: "الشارع", area: "المنطقة", building: "العمارة", floor: "الدور", apartment: "الشقة", landmark: "علامة مميزة (اختياري)", footer: "تأكيد العنوان", cta: "اكتب العنوان" },
};

export const flowCta = (lang) => LABELS[lang === "ar" ? "ar" : "en"].cta;

// One screen, terminal, SingleColumnLayout. Required: street, area, building. The
// Footer's `complete` action echoes every field back as the nfm_reply payload.
export function addressFlowJson(lang = "en") {
  const L = LABELS[lang === "ar" ? "ar" : "en"];
  const input = (name, label, max, required = false) => ({
    type: "TextInput", name, label, "input-type": "text", required, "max-chars": max,
  });
  return {
    version: FLOW_JSON_VERSION,
    screens: [
      {
        id: ADDRESS_SCREEN,
        title: L.title,
        terminal: true,
        data: {},
        layout: {
          type: "SingleColumnLayout",
          children: [
            {
              type: "Form",
              name: "address_form",
              children: [
                input("street", L.street, 80, true),
                input("area", L.area, 40, true),
                input("building", L.building, 20, true),
                input("floor", L.floor, 10),
                input("apartment", L.apartment, 10),
                { type: "TextArea", name: "landmark", label: L.landmark, required: false, "max-length": 200 },
                {
                  type: "Footer",
                  label: L.footer,
                  "on-click-action": {
                    name: "complete",
                    payload: {
                      street: "${form.street}",
                      area: "${form.area}",
                      building: "${form.building}",
                      floor: "${form.floor}",
                      apartment: "${form.apartment}",
                      landmark: "${form.landmark}",
                    },
                  },
                },
              ],
            },
          ],
        },
      },
    ],
  };
}

// flow_token travels with the Flow message and comes back in the completion, so a stale
// completion (form finished after the order was placed, or from another tenant's number)
// is recognisable. Opaque to Meta; no secret inside.
export const flowToken = (restaurantId, sessionId) => `addr|${restaurantId || "default"}|${sessionId}|${Date.now()}`;
export function parseFlowToken(token) {
  const m = /^addr\|([^|]*)\|([^|]+)\|(\d+)$/.exec(String(token || ""));
  return m ? { kind: "addr", restaurantId: m[1] === "default" ? null : m[1], sessionId: m[2], at: Number(m[3]) } : null;
}

const clean = (v) => String(v ?? "").replace(/\s+/g, " ").replace(/[,،|]+/g, " ").trim();

// The completion as the one line a careful guest would have typed — using the SAME
// keywords parseAddress() matches (building/floor/apartment/near — عمارة/الدور/شقة/جنب),
// each labelled chunk comma-separated so the parser's anchors fire, the area LAST so the
// street/area split lands on it. parseAddress(flowReplyToText(x)) round-trips every field
// (test/addressflow.test.mjs).
export function flowReplyToText(payload, lang = "en") {
  const p = payload || {};
  const ar = lang === "ar";
  const street = clean(p.street), area = clean(p.area), building = clean(p.building);
  const floor = clean(p.floor), apartment = clean(p.apartment), landmark = clean(p.landmark);
  const parts = [];
  if (street) parts.push(street);
  if (building) parts.push(`${ar ? "عمارة" : "building"} ${building}`);
  if (floor) parts.push(`${ar ? "الدور" : "floor"} ${floor}`);
  if (apartment) parts.push(`${ar ? "شقة" : "apartment"} ${apartment}`);
  if (landmark) parts.push(`${ar ? "جنب" : "near"} ${landmark}`);
  if (area) parts.push(area);
  return parts.join(", ");
}

// What a Flow completion means for the order: the parsed address, or null when the form
// carried nothing usable (every field blank — the guest tapped through).
export function flowReplyAddress(payload, lang = "en") {
  const text = flowReplyToText(payload, lang);
  return text ? parseAddress(text) : null;
}

// ---------- per-tenant Flow ids ----------
// A tenant opts in with integrations.whatsapp.waba_id (the WABA that owns its number) and
// ai.address_flow = true. No WABA id → feature off, the bot behaves exactly as today.
// Flow ids are looked up (or created + published) once per boot and cached per WABA.
import { listFlows, createFlow } from "./whatsapp.js";
import { log } from "../config.js";

const flowIds = new Map(); // wabaId → { en, ar, at }

export const tenantWabaId = (record) => record?.integrations?.whatsapp?.waba_id || null;
export const addressFlowEnabled = (record) => !!tenantWabaId(record) && record?.ai?.address_flow === true;

export function cachedAddressFlowId(record, lang) {
  const ids = flowIds.get(tenantWabaId(record));
  return ids ? ids[lang === "ar" ? "ar" : "en"] || null : null;
}

// Find `<slug>-address-<lang>-v1` on the WABA (PUBLISHED, or DRAFT while the business is
// unverified — draft Flows still open for the WABA's own test numbers); create + publish it
// when missing. Never throws: a Flow problem must not take the bot down — the deliverer
// falls back to today's location request when no id is cached.
export async function ensureAddressFlows(record, { publish = true } = {}) {
  const wabaId = tenantWabaId(record);
  if (!wabaId) return null;
  const slug = record.slug || "restaurant";
  try {
    const existing = (await listFlows(wabaId))?.data || [];
    const out = { en: null, ar: null, at: Date.now() };
    for (const lang of ["en", "ar"]) {
      const name = flowName(slug, lang);
      const found = existing.filter((f) => f.name === name && f.status !== "DEPRECATED" && f.status !== "BLOCKED" && f.status !== "THROTTLED")
        .sort((a, b) => (a.status === "PUBLISHED" ? -1 : 1) - (b.status === "PUBLISHED" ? -1 : 1))[0];
      if (found) { out[lang] = found.id; continue; }
      const created = await createFlow(wabaId, { name, flowJson: addressFlowJson(lang), publish });
      if (created?.validation_errors?.length) log(`address flow ${name}: validation ${JSON.stringify(created.validation_errors).slice(0, 300)}`);
      out[lang] = created?.id || null;
      log(`address flow ${name}: created${publish ? " + published" : " (draft)"} → ${out[lang] || "no id"}`);
    }
    flowIds.set(wabaId, out);
    return out;
  } catch (e) {
    log(`address flow (${slug}): ${e.message} — falling back to the location request`);
    return null;
  }
}
