import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { restaurantContext } from "../middleware/restaurantContext.js";

const router = Router();
router.use(requireAuth, restaurantContext);

router.get("/sessions", async (req, res, next) => {
  try {
    const rows = await req.repo.list("chat_sessions", { order: "last_message_at" });
    res.json(rows);
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

// Staff reply. In demo mode it just logs to the thread; in production this will
// also forward to the flows service which delivers via WhatsApp/IG.
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
      });
    res.status(201).json(row);
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
