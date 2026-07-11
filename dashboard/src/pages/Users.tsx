import { useEffect, useState } from "react";
import { Plus, KeyRound } from "lucide-react";
import { api } from "../config/api";
import { Card, PageHeader, Pill, Btn, Input, Select, Empty } from "../components/ui";

const ROLES = ["manager", "host", "kitchen", "livechat", "admin"];

export default function Users() {
  const [rows, setRows] = useState<any[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ email: "", name: "", role: "host", password: "" });
  const [error, setError] = useState("");
  const [myPw, setMyPw] = useState({ current: "", password: "" });
  const [pwMsg, setPwMsg] = useState("");

  const load = () => api.get("/api/users").then((r) => setRows(r.data)).catch((e) => setError(e.response?.data?.error || ""));
  useEffect(() => { load(); }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api.post("/api/users", form);
      setShowNew(false);
      setForm({ email: "", name: "", role: "host", password: "" });
      load();
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed");
    }
  }

  async function resetPassword(u: any) {
    const pw = prompt(`New password for ${u.email}: (8+ chars)`);
    if (!pw) return;
    await api.patch(`/api/users/${u.id}`, { password: pw }).catch((e) => alert(e.response?.data?.error || "Failed"));
  }

  async function toggleActive(u: any) {
    await api.patch(`/api/users/${u.id}`, { active: !u.active }).catch(() => {});
    load();
  }

  async function changeMyPassword(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg("");
    try {
      await api.post("/api/users/me/password", myPw);
      setPwMsg("Password changed ✓");
      setMyPw({ current: "", password: "" });
    } catch (err: any) {
      setPwMsg(err.response?.data?.error || "Failed");
    }
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Staff"
        subtitle="Accounts for the dashboard — each role sees only its pages"
        actions={<Btn onClick={() => setShowNew((v) => !v)}><span className="flex items-center gap-1.5"><Plus size={15} /> Add staff</span></Btn>}
      />
      {error && <Card className="mb-4 border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{error}</Card>}

      {showNew && (
        <Card className="mb-5 p-5">
          <form onSubmit={create} className="grid gap-3 md:grid-cols-2">
            <Input type="email" placeholder="Email *" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <Input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
            <Input type="password" placeholder="Password * (8+ chars)" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <div className="md:col-span-2"><Btn type="submit">Create account</Btn></div>
          </form>
        </Card>
      )}

      {rows.length === 0 ? (
        <Card><Empty text="No staff accounts" /></Card>
      ) : (
        <div className="space-y-2">
          {rows.map((u) => (
            <Card key={u.id} className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${u.active === false ? "opacity-50" : ""}`}>
              <div>
                <div className="text-sm font-medium">{u.name || u.email}</div>
                <div className="text-xs text-zinc-500">{u.email}</div>
              </div>
              <div className="flex items-center gap-2">
                <Pill value={u.role} />
                <Btn variant="ghost" className="px-2.5 py-1.5 text-xs" onClick={() => resetPassword(u)}>
                  <span className="flex items-center gap-1"><KeyRound size={12} /> Reset password</span>
                </Btn>
                <Btn variant={u.active === false ? "primary" : "danger"} className="px-2.5 py-1.5 text-xs" onClick={() => toggleActive(u)}>
                  {u.active === false ? "Activate" : "Deactivate"}
                </Btn>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Card className="mt-8 p-5">
        <h2 className="mb-3 text-sm font-semibold text-zinc-200">Change my password</h2>
        <form onSubmit={changeMyPassword} className="flex flex-wrap items-center gap-3">
          <Input type="password" placeholder="Current password" value={myPw.current} onChange={(e) => setMyPw({ ...myPw, current: e.target.value })} />
          <Input type="password" placeholder="New password (8+)" value={myPw.password} onChange={(e) => setMyPw({ ...myPw, password: e.target.value })} />
          <Btn type="submit">Change</Btn>
          {pwMsg && <span className={`text-sm ${pwMsg.includes("✓") ? "text-emerald-400" : "text-red-400"}`}>{pwMsg}</span>}
        </form>
      </Card>
    </div>
  );
}
