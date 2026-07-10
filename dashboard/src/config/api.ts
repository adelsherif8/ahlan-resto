import axios from "axios";

export const API = import.meta.env.VITE_API_URL ?? "http://localhost:5051";

export const api = axios.create({ baseURL: API });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("resto_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401 && !location.pathname.includes("/login")) {
      localStorage.removeItem("resto_token");
      location.href = "/login";
    }
    return Promise.reject(err);
  }
);

export function session() {
  return {
    token: localStorage.getItem("resto_token"),
    role: localStorage.getItem("resto_role") || "",
    name: localStorage.getItem("resto_name") || "",
    restaurant: localStorage.getItem("resto_restaurant") || "",
  };
}
