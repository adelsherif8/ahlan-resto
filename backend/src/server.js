import express from "express";
import cors from "cors";
import morgan from "morgan";
import { PORT, DEMO_MODE, log } from "./config/env.js";

import authRoutes from "./routes/authRoutes.js";
import reservationsRoutes from "./routes/reservationsRoutes.js";
import tablesRoutes from "./routes/tablesRoutes.js";
import menuRoutes from "./routes/menuRoutes.js";
import dinersRoutes from "./routes/dinersRoutes.js";
import waitlistRoutes from "./routes/waitlistRoutes.js";
import reviewsRoutes from "./routes/reviewsRoutes.js";
import ordersRoutes from "./routes/ordersRoutes.js";
import couriersRoutes from "./routes/couriersRoutes.js";
import chatRoutes from "./routes/chatRoutes.js";
import kpisRoutes from "./routes/kpisRoutes.js";
import settingsRoutes from "./routes/settingsRoutes.js";
import eventsRoutes from "./routes/eventsRoutes.js";
import usersRoutes from "./routes/usersRoutes.js";

const app = express();
// CORS allowlist: the dashboard (Vercel) + localhost dev. No-Origin requests (server-to-
// server, curl, health checks) pass — CORS only gates browsers.
const ALLOWED_ORIGINS = new Set(["https://ahlan-resto.vercel.app", "https://app.munadim.com", "https://munadim-dashboard.pages.dev"]);
app.use(cors({
  origin(origin, cb) {
    if (!origin || ALLOWED_ORIGINS.has(origin) || /^https?:\/\/localhost(:\d+)?$/.test(origin)) return cb(null, true);
    cb(null, false);
  },
}));
app.use(express.json({ limit: "5mb" }));
app.use(morgan("tiny"));

app.get("/api/health", (_req, res) => res.json({ ok: true, demo: DEMO_MODE }));

app.use("/api/auth", authRoutes);
app.use("/api/reservations", reservationsRoutes);
app.use("/api/tables", tablesRoutes);
app.use("/api/menu", menuRoutes);
app.use("/api/diners", dinersRoutes);
app.use("/api/waitlist", waitlistRoutes);
app.use("/api/orders", ordersRoutes);
app.use("/api/couriers", couriersRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/dashboard", kpisRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/events", eventsRoutes);
app.use("/api/reviews", reviewsRoutes);
app.use("/api/users", usersRoutes);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Internal error" });
});

app.listen(PORT, () => {
  log(`ahlan-resto backend on :${PORT} ${DEMO_MODE ? "(DEMO MODE — in-memory data)" : "(real mode)"}`);
});
