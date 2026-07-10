import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config/env.js";

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function allowRoles(...roles) {
  return (req, res, next) => {
    const role = req.user?.role;
    if (role === "admin" || roles.includes(role)) return next();
    return res.status(403).json({ error: "Forbidden" });
  };
}
