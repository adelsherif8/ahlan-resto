// INTENT — a second opinion for the router's classify step, from TypeSafe AI's Jev
// (a "System One" decision model: typed choice + calibrated probabilities, no text).
//
// Why it exists: MASTER's classifier is the one place a tiny model picks a bucket
// (reservation | arrival | events | order | friendly) when none of the code rules fired.
// Jev answers that exact shape — a closed set of labels with descriptions — in 70–500 ms
// for $0.042 per million input tokens, and returns a probability per bucket, so a low
// confidence can be acted on instead of guessed over.
//
// Why it is NOT the router yet: TypeSafe says English is the primary training language
// and other languages are "handled but not equally well"; Arabic and Franco-Arabizi are
// not mentioned anywhere in their docs, and most of our guests write exactly those. So
// the integration ships DORMANT and runs in SHADOW first: Jev is asked on every
// classify turn, its answer is written next to the nano classifier's in the trace
// (`jev.bucket`, `jev.confidence`, `jev.agrees`), and nothing it says reaches the guest.
// A week of real Arabic/Franco traffic in the ops console decides whether it earns
// `primary`.
//
//   JEV_API_KEY   — from console.typesafe.ai/keys. Unset → this file does nothing.
//   JEV_MODE      — off | shadow (default when a key exists) | primary
//   JEV_MIN_CONF  — primary only: below this confidence the nano classifier decides (0.75)
//   JEV_MODEL     — jev-latest (default) | jev-preview | jev-1.14.0 …
import { log } from "../config.js";

export const JEV_API_KEY = process.env.JEV_API_KEY || "";
export const JEV_MODE = (process.env.JEV_MODE || (JEV_API_KEY ? "shadow" : "off")).toLowerCase();
export const JEV_MIN_CONF = Number(process.env.JEV_MIN_CONF) || 0.75;
const JEV_MODEL = process.env.JEV_MODEL || "jev-latest";
const JEV_URL = process.env.JEV_URL || "https://api.typesafe.ai/v1/systemone";
const PRICE_IN_PER_TOKEN = 0.042 / 1e6; // output tokens are free (docs.typesafe.ai/models, Oct 2026)
const TIMEOUT_MS = 2500;                // a guest is waiting — past this the nano answer stands alone

export const jevReady = () => !!JEV_API_KEY && JEV_MODE !== "off";

// The same five buckets MASTER's prompt describes, as Jev "criteria" (label → description).
// Kept short and literal: Jev reads instructions literally and leans to the first option
// when unsure (docs: model jaggedness), so "friendly" — our default bucket — goes first.
export function bucketCriteria({ orderInProgress = false, casual = true } = {}) {
  return {
    friendly: "Greetings, menu questions, prices, ingredients, hours, location, complaints, chit-chat, or anything unclear (the default)",
    order: casual
      ? `Wants food made now: placing, changing or cancelling an order, chasing one ("where's my order"), or answering a question about an order being built${orderInProgress ? " — an order IS in progress, so a bare answer like a drink name, 'cash', a branch or an address belongs here" : ""}`
      : "Wants to place or change a food order",
    reservation: "Booking, changing or cancelling a TABLE (not food): party size, date, time",
    arrival: "Says they are at or near the restaurant now, or running late for a booking",
    events: "Asks about parties, DJ nights, special events, or wants to RSVP",
  };
}

/**
 * Ask Jev which bucket the guest's latest message belongs to.
 * Resolves to null on any failure (timeout, 4xx/5xx, unparsable) — never throws.
 */
export async function jevClassify({ message, lastAiMessage = null, orderInProgress = false, stage = null, casual = true, language = null }) {
  if (!jevReady()) return null;
  const t0 = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const body = {
      model: JEV_MODEL,
      // structured state: Jev can read a chat log; our own last line is the context the
      // guest is answering, and the order flag is the CONTINUATION RULE from the prompt
      state: {
        our_last_message: String(lastAiMessage || "").slice(0, 400) || null,
        order_in_progress: orderInProgress ? (stage || "yes") : "no",
        guest_language_hint: language || null,
        guest_message: String(message || "").slice(0, 600),
      },
      questions: {
        bucket: {
          type: "choice",
          instructions: "Which agent should answer `guest_message`? Judge the guest's latest message in the light of `our_last_message` and `order_in_progress`.",
          criteria: bucketCriteria({ orderInProgress, casual }),
        },
      },
    };
    const res = await fetch(JEV_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${JEV_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const ms = Date.now() - t0;
    if (!res.ok) { log(`jev ${res.status}: ${(await res.text().catch(() => "")).slice(0, 160)}`); return null; }
    const data = await res.json();
    const a = data?.answers?.bucket;
    if (!a?.choice) return null;
    const tin = Number(data?.usage?.input_tokens) || 0;
    return {
      bucket: String(a.choice),
      confidence: Number(a.confidence) || 0,
      probabilities: a.probabilities || {},
      ms,
      model: data.model || JEV_MODEL,
      __usage: { model: data.model || JEV_MODEL, tokens_in: tin, tokens_out: Number(data?.usage?.output_tokens) || 0, tokens_cached: 0, cost_usd: tin * PRICE_IN_PER_TOKEN },
    };
  } catch (e) {
    log(`jev failed (${Date.now() - t0}ms): ${e?.name === "AbortError" ? "timeout" : e.message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
