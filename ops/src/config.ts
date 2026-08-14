import axios from "axios";

export const FLOWS_URL = import.meta.env.VITE_FLOWS_URL ?? "http://localhost:5052";

export const ops = axios.create({ baseURL: FLOWS_URL });

ops.interceptors.request.use((config) => {
  const token = localStorage.getItem("ahlan_ops_token") || (import.meta.env.VITE_OPS_TOKEN ?? "");
  if (token) config.headers["x-ops-token"] = token;
  return config;
});

// A locally-run console can take the token from its own env, so nobody has to paste
// a secret into a form to read their own traces. localStorage still wins if set.
export function getToken() {
  return localStorage.getItem("ahlan_ops_token") || (import.meta.env.VITE_OPS_TOKEN ?? "");
}
export function setToken(t: string) {
  localStorage.setItem("ahlan_ops_token", t);
}
export function clearToken() {
  localStorage.removeItem("ahlan_ops_token");
}
