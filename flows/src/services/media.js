// Media pipeline: voice → Whisper text, image → vision classify+describe,
// upload to tenant storage so the dashboards can render it.
import { OPENAI_API_KEY, log } from "../config.js";
import { downloadMedia, WA_TOKEN } from "./whatsapp.js";

const BUCKET = "chat-media";

export async function transcribeAudio(buffer, mime) {
  if (!OPENAI_API_KEY) return "[voice note — transcription unavailable]";
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mime }), "audio.ogg");
  form.append("model", "whisper-1");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });
  if (!res.ok) throw new Error(`whisper ${res.status}`);
  const data = await res.json();
  return data.text || "[voice note — empty transcription]";
}

export async function classifyImage(buffer, mime, caption) {
  if (!OPENAI_API_KEY) return { kind: "general", description: "[image]", __usage: null };
  const b64 = buffer.toString("base64");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 150,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: 'Classify a photo sent to a restaurant WhatsApp. JSON: {"kind":"menu_question|complaint_photo|general","description":"one sentence"}' },
        { role: "user", content: [{ type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } }, { type: "text", text: caption || "guest sent this photo" }] },
      ],
    }),
  });
  if (!res.ok) throw new Error(`vision ${res.status}`);
  const data = await res.json();
  const u = data.usage || {};
  let value = { kind: "general", description: "[image]" };
  try { value = JSON.parse(data.choices?.[0]?.message?.content || "{}"); } catch {}
  return { ...value, __usage: { model: "gpt-4o-mini", tokens_in: u.prompt_tokens || 0, tokens_out: u.completion_tokens || 0, cost_usd: ((u.prompt_tokens || 0) * 0.15 + (u.completion_tokens || 0) * 0.6) / 1e6 } };
}

export async function storeMedia(db, supabaseUrl, buffer, mime, sessionId) {
  try {
    const ext = mime.split("/")[1]?.split(";")[0] || "bin";
    const path = `${sessionId.replace(/[^a-z0-9]/gi, "_")}/${Date.now()}.${ext}`;
    const { error } = await db.storage.from(BUCKET).upload(path, buffer, { contentType: mime, upsert: true });
    if (error) {
      // bucket may not exist yet — create once, retry
      await db.storage.createBucket(BUCKET, { public: true }).catch(() => {});
      const retry = await db.storage.from(BUCKET).upload(path, buffer, { contentType: mime, upsert: true });
      if (retry.error) throw new Error(retry.error.message);
    }
    const { data } = db.storage.from(BUCKET).getPublicUrl(path);
    return data?.publicUrl || null;
  } catch (e) {
    log("media store failed:", e.message);
    return null;
  }
}

// Full WhatsApp media handling: download → (whisper | vision) → store.
// Returns { text, mediaUrl, mediaType, usage }
export async function processWaMedia(db, event) {
  if (!WA_TOKEN) return { text: `[${event.media.kind} received — media processing needs WA_TOKEN]`, mediaUrl: null, mediaType: event.media.kind };
  const { buffer, mime } = await downloadMedia(event.media.id);
  const mediaUrl = await storeMedia(db, null, buffer, mime, event.from);
  if (event.media.kind === "audio") {
    const text = await transcribeAudio(buffer, mime);
    return { text: `[voice] ${text}`, mediaUrl, mediaType: "audio" };
  }
  if (event.media.kind === "image") {
    const cls = await classifyImage(buffer, mime, event.media.caption);
    const cap = event.media.caption ? ` — caption: "${event.media.caption}"` : "";
    return { text: `[photo: ${cls.kind}] ${cls.description}${cap}`, mediaUrl, mediaType: "image", usage: cls.__usage };
  }
  return { text: `[${event.media.kind}]${event.media.caption ? " " + event.media.caption : ""}`, mediaUrl, mediaType: event.media.kind };
}
