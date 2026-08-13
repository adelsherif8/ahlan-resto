import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Flame } from "lucide-react";
import { api } from "../config/api";
import { ROLE_HOME } from "../auth/ProtectedRoute";
import { Btn, Input } from "../components/ui";

export default function Login() {
  const nav = useNavigate();
  const [email, setEmail] = useState("owner@demo.resto");
  const [password, setPassword] = useState("demo123");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const { data } = await api.post("/api/auth/login", { email, password });
      localStorage.setItem("resto_token", data.token);
      localStorage.setItem("resto_role", data.user.role);
      localStorage.setItem("resto_branch", data.user.branch || "");
      localStorage.setItem("resto_name", data.user.name || "");
      localStorage.setItem("resto_restaurant", data.restaurant?.name || "");
      nav(ROLE_HOME[data.user.role] || "/overview");
    } catch (err: any) {
      setError(err.response?.data?.error || "Login failed — is the backend running?");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center justify-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-500 text-zinc-950">
            <Flame size={22} />
          </div>
          <div>
            <div className="text-xl font-bold">Munadim</div>
            <div className="text-xs text-zinc-400">Restaurant dashboard</div>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="w-full" />
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" className="w-full" />
          {error && <div className="text-sm text-red-400">{error}</div>}
          <Btn type="submit" disabled={loading} className="w-full">
            {loading ? "Signing in…" : "Sign in"}
          </Btn>
          <p className="pt-1 text-center text-xs text-zinc-500">
            Demo: owner@demo.resto / demo123 (also host@ and kitchen@)
          </p>
        </form>
      </div>
    </div>
  );
}
