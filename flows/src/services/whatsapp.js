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
  if (WA_SKIP_SIGNATURE || !WA_APP_SECRET) return true;
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
          interactive: msg.interactive
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

export async function sendImage(phoneNumberId, to, imageUrl, caption = "") {
  return graphPost(phoneNumberId, { to, type: "image", image: { link: imageUrl, caption: caption.slice(0, 1024) } });
}

// Quick-reply buttons (max 3, 20-char titles). Tapping one sends its title back
// as a normal message — ingest already parses interactive button replies.
export async function sendButtons(phoneNumberId, to, bodyText, labels) {
  const buttons = labels.slice(0, 3).map((l, i) => ({
    type: "reply",
    reply: { id: `qr_${i}_${String(l).replace(/[^\w]/g, "").slice(0, 12)}`, title: String(l).slice(0, 20) },
  }));
  return graphPost(phoneNumberId, {
    to,
    type: "interactive",
    interactive: { type: "button", body: { text: bodyText.slice(0, 1024) }, action: { buttons } },
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
