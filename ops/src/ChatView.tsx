import { useEffect, useRef, useState } from "react";
import { Send, Bot, RefreshCw } from "lucide-react";
import { ops } from "./config";
import { Card, Btn, Input } from "./ui";

type Msg = { sender: string; message: string; at: string; media_url?: string | null; media_type?: string | null };

function getSessionId() {
  let sid = localStorage.getItem("ahlan_ops_session");
  if (!sid) {
    sid = "web:" + Math.random().toString(36).slice(2, 10);
    localStorage.setItem("ahlan_ops_session", sid);
  }
  return sid;
}

export default function ChatView() {
  const [sessionId, setSessionId] = useState(getSessionId());
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [waiting, setWaiting] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const poll = () =>
      ops.get("/api/web/poll", { params: { sessionId } }).then((r) => {
        setMessages(r.data);
        if (r.data.length && r.data[r.data.length - 1].sender !== "guest") setWaiting(false);
      }).catch(() => {});
    poll();
    const t = setInterval(poll, 2000);
    return () => clearInterval(t);
  }, [sessionId]);

  useEffect(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), [messages.length]);

  // typing events: extend the buffer window while the tester is typing (like a real guest widget)
  const lastTypingRef = useRef(0);
  function onType(v: string) {
    setText(v);
    const now = Date.now();
    if (now - lastTypingRef.current > 1500) {
      lastTypingRef.current = now;
      ops.post("/api/web/typing", { sessionId }).catch(() => {});
    }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    const msg = text;
    setText("");
    setWaiting(true);
    setMessages((m) => [...m, { sender: "guest", message: msg, at: new Date().toISOString() }]);
    await ops.post("/api/web/send", { sessionId, message: msg }).catch(() => setWaiting(false));
  }

  function newSession() {
    localStorage.removeItem("ahlan_ops_session");
    setMessages([]);
    setSessionId(getSessionId());
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-140px)] max-w-3xl flex-col">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-zinc-400">
          Testing as guest <span className="font-mono text-zinc-300">{sessionId}</span> — messages merge after ~8s of silence, then run the full pipeline. Watch it live in Flows.
        </div>
        <Btn variant="ghost" onClick={newSession}><span className="flex items-center gap-1.5"><RefreshCw size={14} /> New guest</span></Btn>
      </div>
      <Card className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {messages.length === 0 && (
            <div className="py-16 text-center text-sm text-zinc-500">
              <Bot className="mx-auto mb-3 text-amber-500" size={32} />
              Try "do you have vegan options?", "3ayez tarabeza l 4 bokra", or 3 quick messages to see the merge.
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.sender === "guest" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm ${m.sender === "guest" ? "bg-sky-500/20 text-sky-100" : "bg-amber-500/15 text-amber-100"}`}>
                {m.sender !== "guest" && <div className="mb-0.5 text-[10px] uppercase tracking-wide opacity-60">{m.sender}</div>}
                {m.media_url && m.media_type === "image" && <img src={m.media_url} alt="" className="mb-1.5 max-h-52 rounded-xl" />}
                {m.media_url && m.media_type === "audio" && <audio controls src={m.media_url} className="mb-1.5 h-9 w-56" />}
                {m.message}
              </div>
            </div>
          ))}
          {waiting && (
            <div className="flex justify-start">
              <div className="rounded-2xl bg-zinc-800 px-3.5 py-2 text-sm text-zinc-400">
                <span className="animate-pulse">buffering… merging messages, then thinking</span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
        <form onSubmit={send} className="flex gap-2 border-t border-zinc-800 p-3">
          <Input className="flex-1" placeholder="Message as a guest… (typing extends the buffer window)" value={text} onChange={(e) => onType(e.target.value)} />
          <Btn type="submit"><Send size={15} /></Btn>
        </form>
      </Card>
    </div>
  );
}
