import { Navigate } from "react-router-dom";
import type { ReactNode } from "react";
import { session } from "../config/api";

export const ROLE_HOME: Record<string, string> = {
  admin: "/overview",
  manager: "/overview",
  host: "/reservations",
  kitchen: "/orders",
  livechat: "/chats",
};

export default function ProtectedRoute({ roles, children }: { roles?: string[]; children: ReactNode }) {
  const { token, role } = session();
  if (!token) return <Navigate to="/login" replace />;
  if (roles && role !== "admin" && !roles.includes(role))
    return <Navigate to={ROLE_HOME[role] || "/overview"} replace />;
  return <>{children}</>;
}
