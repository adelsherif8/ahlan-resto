import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { restaurantContext } from "../middleware/restaurantContext.js";
import { FLOWS_URL, FLOWS_OPS_TOKEN, log } from "../config/env.js";

const router = Router();
router.use(requireAuth, restaurantContext);

router.get("/sessions", async (req, res, next) => {
  try {
    const rows = await req.repo.list("chat_sessions", { order: "last_message_at" });
    // attach the diner's name (guest-confirmed first, WhatsApp profile as fallback)
    let byPhone = new Map();
    try {
      const diners = await req.repo.list("diners");
      byPhone = new Map(diners.map((d) => [d.phone_number, d]));
    } catch {}
    res.json(rows.map((s) => {
      const d = byPhone.get(s.phone_number || s.session_id);
      return { ...s, diner_name: d?.name || d?.wa_profile_name || null };
    }));
  } catch (e) { next(e); }
});

// Everything the AI knows about this guest — powers the live-chat context panel.
// Same data FRIENDLY reads, so staff taking over sees exactly what the bot saw.
router.get("/sessions/:sessionId/context", async (req, res, next) => {
  try {
    const sid = req.params.sessionId;
    const sessions = await req.repo.list("chat_sessions", { where: { session_id: sid } });
    let diner = null, upcoming = null, summary = null;
    try {
      const diners = await req.repo.list("diners", { where: { phone_number: sid } });
      diner = diners[0] || null;
    } catch {}
    try {
      const today = new Date().toISOString().slice(0, 10);
      upcoming = (await req.repo.list("reservations", { order: "date" }))
        .filter((r) => r.diner_phone === sid && r.date >= today &&
          ["pending", "confirmed", "reminded", "arrived", "seated"].includes(r.status))[0] || null;
    } catch {}
    try {
      const mf = await req.repo.list("message_full", { where: { phone_number: sid } });
      summary = mf[0]?.conversation_summary || null;
    } catch {}
    res.json({ session: sessions[0] || null, diner, upcoming_reservation: upcoming, summary });
  } catch (e) { next(e); }
});

router.get("/sessions/:sessionId/messages", async (req, res, next) => {
  try {
    const rows = await req.repo.list("chat_messages", {
      where: { session_id: req.params.sessionId },
      order: "created_at",
      desc: false,
    });
    res.json(rows);
  } catch (e) { next(e); }
});

// Staff reply: logged to the thread, then relayed to the flows service which delivers
// to the guest's channel (WhatsApp/IG) and enters it into the AI's history.
router.post("/sessions/:sessionId/messages", async (req, res, next) => {
  try {
    const { message } = req.body || {};
    if (!message) return res.status(400).json({ error: "message required" });
    const row = await req.repo.insert("chat_messages", {
      session_id: req.params.sessionId,
      sender: "staff",
      message,
      status: "sent",
      wa_message_id: `staff-${Date.now()}`,
    });
    const sessions = await req.repo.list("chat_sessions", { where: { session_id: req.params.sessionId } });
    if (sessions[0])
      await req.repo.update("chat_sessions", sessions[0].id, {
        last_message: message,
        last_message_at: new Date().toISOString(),
        needs_attention: false,
        ai_enabled: false, // staff replied → auto-takeover so two voices never talk over each other
      });

    let delivery = { delivered: false, reason: "FLOWS_URL not set (demo mode)" };
    if (FLOWS_URL) {
      try {
        const r = await fetch(`${FLOWS_URL}/api/staff/reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(FLOWS_OPS_TOKEN ? { "x-ops-token": FLOWS_OPS_TOKEN } : {}) },
          body: JSON.stringify({ sessionId: req.params.sessionId, message }),
        });
        delivery = r.ok ? await r.json() : { delivered: false, reason: `flows ${r.status}` };
      } catch (e) {
        delivery = { delivered: false, reason: e.message };
        log("staff reply relay failed:", e.message);
      }
    }
    res.status(201).json({ ...row, delivery });
  } catch (e) { next(e); }
});

// Staff quality signal on AI replies (👍=1 / 👎=-1, 0 clears) — feeds prompt fixes + metrics
router.post("/messages/:id/rate", async (req, res, next) => {
  try {
    const rating = Number(req.body?.rating);
    if (![1, -1, 0].includes(rating)) return res.status(400).json({ error: "rating must be 1, -1 or 0" });
    const row = await req.repo.update("chat_messages", req.params.id, { rating: rating === 0 ? null : rating });
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  } catch (e) { next(e); }
});

// Toggle AI per conversation (handoff / hand-back)
router.patch("/sessions/:id", async (req, res, next) => {
  try {
    const patch = {};
    for (const k of ["ai_enabled", "needs_attention", "status", "handoff_reason"])
      if (k in req.body) patch[k] = req.body[k];
    const row = await req.repo.update("chat_sessions", req.params.id, patch);
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  } catch (e) { next(e); }
});

export default router;
