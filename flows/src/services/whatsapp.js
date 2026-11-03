// WhatsApp Cloud API adapter — fully implemented, dormant until WA_TOKEN is set.
// Parses EVERY inbound payload type (text, audio, image, video, document, sticker,
// location, contacts, reaction, interactive button/list replies) so real payloads
// are visible in the ops console the moment a real number is connected.
import crypto from "node:crypto";
import { log } from "../config.js";

export const WA_TOKEN = process.env.WA_TOKEN || "";
export const WA_APP_SECRET = process.env.WA_APP_SECRET || "";
export const WA_VERIFY_TOKEN = process.env.WA_VERIFY_TOKEN || "ahlan-verify";
// our WhatsApp Business number's phone-number-id — fallback for outbound sends when the
// in-memory session route is gone (staff replies after a redeploy, cron messages later)
export const WA_PHONE_NUMBER_ID = process.env.WA_PHONE_NUMBER_ID || "";
export const WA_SKIP_SIGNATURE = process.env.WA_SKIP_SIGNATURE === "1";
export const DRY_RUN = process.env.DRY_RUN === "1" || !WA_TOKEN;
const GRAPH = "https://graph.facebook.com/v24.0";

export function verifyHandshake(query) {
  if (query["hub.mode"] === "subscribe" && query["hub.verify_token"] === WA_VERIFY_TOKEN) {
    return query["hub.challenge"];
  }
  return null;
}

export function verifySignature(rawBody, signatureHeader) {
  if (WA_SKIP_SIGNATURE) return true; // explicit dev opt-out ONLY (WA_SKIP_SIGNATURE=1)
  // FAIL CLOSED: no app secret configured = no way to verify = drop the payload.
  // (Returning true here would let anyone forge inbound "messages" — poisoned history,
  // LLM spend, outbound sends to arbitrary numbers.)
  if (!WA_APP_SECRET) { log("WA webhook: WA_APP_SECRET not set — dropping unverifiable payload"); return false; }
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", WA_APP_SECRET).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(signatureHeader.slice(7)), Buffer.from(expected));
  } catch {
    return false;
  }
}

// Returns { events: [...], statuses: [...], raw } — one event per inbound guest message.
export function parseEnvelope(body) {
  const events = [];
  const statuses = [];
  for (const entry of body?.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const phoneNumberId = value.metadata?.phone_number_id || null;
      for (const st of value.statuses || []) {
        statuses.push({ id: st.id, status: st.status, recipient: st.recipient_id, phoneNumberId });
      }
      const contacts = value.contacts || [];
      for (const msg of value.messages || []) {
        const profileName = contacts.find((c) => c.wa_id === msg.from)?.profile?.name || null;
        events.push({
          phoneNumberId,
          from: msg.from,
          profileName,
          messageId: msg.id,
          timestamp: msg.timestamp,
          type: msg.type, // text|audio|image|video|document|sticker|location|contacts|reaction|interactive|button|order|unknown
          text: msg.text?.body || null,
          media:
            msg.audio || msg.image || msg.video || msg.document || msg.sticker
              ? { kind: msg.type, id: (msg.audio || msg.image || msg.video || msg.document || msg.sticker)?.id, mime: (msg.audio || msg.image || msg.video || msg.document || msg.sticker)?.mime_type, caption: msg.image?.caption || msg.video?.caption || msg.document?.caption || null }
              : null,
          location: msg.location ? { lat: msg.location.latitude, lng: msg.location.longitude, name: msg.location.name || null, address: msg.location.address || null } : null,
          contacts_card: msg.contacts || null,
          reaction: msg.reaction ? { emoji: msg.reaction.emoji, to_message_id: msg.reaction.message_id } : null,
          interactive: msg.interactive?.type === "nfm_reply"
            // a WhatsApp Flow completion: response_json is a STRING holding flow_token + the form fields
            ? { kind: "nfm_reply", id: null, title: null, flow: parseFlowReply(msg.interactive.nfm_reply?.response_json), context_id: msg.context?.id || null }
            : msg.interactive
            ? { kind: msg.interactive.type, id: msg.interactive.button_reply?.id || msg.interactive.list_reply?.id || null, title: msg.interactive.button_reply?.title || msg.interactive.list_reply?.title || null }
            : msg.button
            ? { kind: "button", id: msg.button.payload, title: msg.button.text }
            : null,
          raw: msg, // full raw payload — inspect in ops console
        });
      }
    }
  }
  return { events, statuses };
}

function parseFlowReply(responseJson) {
  try {
    const v = typeof responseJson === "string" ? JSON.parse(responseJson) : responseJson;
    return v && typeof v === "object" ? v : {};
  } catch {
    return {}; // a broken completion is an empty form, never a dropped webhook
  }
}

// ---------- WhatsApp Flows (native forms) — docs/WA-FLOWS-PLAN.md ----------
// Send a Flow message: the guest taps `cta`, the form opens on `screen`, the completion
// comes back as an nfm_reply carrying `token` and the form fields. `mode:"draft"` tests an
// unpublished Flow (only Meta testers / the WABA's own numbers can open it).
export async function sendFlow(phoneNumberId, to, bodyText, { flowId, cta, screen, token, mode = null, data = null }) {
  if (!flowId) throw new Error("sendFlow: no flowId");
  const parameters = {
    flow_message_version: "3",
    flow_id: String(flowId),
    flow_cta: String(cta || "Open").slice(0, 30),
    flow_action: "navigate",
    flow_token: String(token || ""),
    flow_action_payload: { screen: String(screen || "ADDRESS"), ...(data ? { data } : {}) },
    ...(mode ? { mode } : {}),
  };
  return graphPost(phoneNumberId, {
    to, type: "interactive",
    interactive: { type: "flow", body: { text: String(bodyText).slice(0, 1024) }, action: { name: "flow", parameters } },
  });
}

async function graphCall(method, path, payload = null) {
  if (DRY_RUN) {
    log(`[DRY_RUN WA ${method} ${path}] ${payload ? JSON.stringify(payload).slice(0, 160) : ""}`);
    return { dry_run: true, data: [] };
  }
  const res = await fetch(`${GRAPH}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`WA ${method} ${path} ${res.status}: ${JSON.stringify(data).slice(0, 240)}`);
  return data;
}

// WABA-level Flow management (needs whatsapp_business_management on the token).
export const listFlows = (wabaId) => graphCall("GET", `${wabaId}/flows?fields=id,name,status,categories`);
export const createFlow = (wabaId, { name, flowJson, publish = false, categories = ["OTHER"] }) =>
  graphCall("POST", `${wabaId}/flows`, { name, categories, flow_json: JSON.stringify(flowJson), publish });
export const publishFlow = (flowId) => graphCall("POST", `${flowId}/publish`);

async function graphPost(phoneNumberId, payload) {
  if (DRY_RUN) {
    log(`[DRY_RUN WA →] ${JSON.stringify(payload).slice(0, 200)}`);
    return { dry_run: true };
  }
  const res = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`WA send ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return data;
}

export async function sendText(phoneNumberId, to, text) {
  return graphPost(phoneNumberId, { to, type: "text", text: { body: text.slice(0, 4096) } });
}

// WhatsApp image links accept ONLY jpeg/png — .webp (e.g. CDN product shots) is
// silently rejected. Convert through an image proxy at send time.
const imageLink = (url) => /\.webp(\?|$)/i.test(url)
  ? `https://images.weserv.nl/?url=${encodeURIComponent(url.replace(/^https?:\/\//, ""))}&output=jpg&q=85`
  : url;

export async function sendImage(phoneNumberId, to, imageUrl, caption = "") {
  return graphPost(phoneNumberId, { to, type: "image", image: { link: imageLink(imageUrl), caption: caption.slice(0, 1024) } });
}

// Quick-reply buttons (max 3, 20-char titles). Tapping one sends its title back
// as a normal message — ingest already parses interactive button replies.
// Native location-request: the guest gets WhatsApp's one-tap location picker —
// no typed addresses, no typos. Counts as ONE interactive message.
export async function sendLocationRequest(phoneNumberId, to, bodyText) {
  return graphPost(phoneNumberId, {
    to, type: "interactive",
    interactive: { type: "location_request_message", body: { text: String(bodyText).slice(0, 1024) }, action: { name: "send_location" } },
  });
}

export async function sendButtons(phoneNumberId, to, bodyText, labels, headerImageUrl = null) {
  const buttons = labels.slice(0, 3).map((l, i) => ({
    type: "reply",
    reply: { id: `qr_${i}_${String(l).replace(/[^\w]/g, "").slice(0, 12)}`, title: String(l).slice(0, 20) },
  }));
  const interactive = { type: "button", body: { text: bodyText.slice(0, 1024) }, action: { buttons } };
  // A dish answer, its photo AND its buttons can be ONE message — the image rides
  // as the interactive header instead of a second bubble.
  if (headerImageUrl) interactive.header = { type: "image", image: { link: imageLink(headerImageUrl) } };
  return graphPost(phoneNumberId, {
    to,
    type: "interactive",
    interactive,
  });
}

// List message (10 rows total across sections). Tapping a row sends its title back.
export async function sendList(phoneNumberId, to, bodyText, buttonLabel, sections) {
  return graphPost(phoneNumberId, {
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: bodyText.slice(0, 1024) },
      action: { button: String(buttonLabel).slice(0, 20), sections },
    },
  });
}

// Document (e.g. the restaurant's designed PDF menu)
export async function sendDocument(phoneNumberId, to, link, caption = "", filename = "menu.pdf") {
  return graphPost(phoneNumberId, {
    to,
    type: "document",
    document: { link, caption: String(caption).slice(0, 1024), filename },
  });
}

// Real map pin — much better than a link on WhatsApp
export async function sendLocation(phoneNumberId, to, lat, lng, name = "", address = "") {
  return graphPost(phoneNumberId, {
    to,
    type: "location",
    location: { latitude: lat, longitude: lng, name: String(name).slice(0, 100), address: String(address).slice(0, 200) },
  });
}

export async function sendReaction(phoneNumberId, to, messageId, emoji) {
  return graphPost(phoneNumberId, { to, type: "reaction", reaction: { message_id: messageId, emoji } });
}

// mark read + show typing indicator (Cloud API combined call)
export async function markReadWithTyping(phoneNumberId, messageId) {
  if (DRY_RUN) return { dry_run: true };
  const res = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: messageId, typing_indicator: { type: "text" } }),
  });
  return res.json().catch(() => ({}));
}

export async function downloadMedia(mediaId) {
  if (!WA_TOKEN) throw new Error("WA_TOKEN not set");
  const meta = await fetch(`${GRAPH}/${mediaId}`, { headers: { Authorization: `Bearer ${WA_TOKEN}` } }).then((r) => r.json());
  const bin = await fetch(meta.url, { headers: { Authorization: `Bearer ${WA_TOKEN}` } });
  return { buffer: Buffer.from(await bin.arrayBuffer()), mime: meta.mime_type || "application/octet-stream" };
}
