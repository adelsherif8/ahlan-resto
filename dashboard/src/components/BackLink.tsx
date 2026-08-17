import { ArrowLeft } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

// The return half of a deep link. Jumping from a conversation to its ticket is only
// useful if you can get back to the conversation — otherwise the "jump" costs you your
// place and staff stop using it. The origin travels in router state (not the URL) so it
// survives a normal navigation but never leaks into a copied or bookmarked link.
//
// Send someone across with:
//   nav("/orders?code=O-8H2W", { state: { backTo: "/chats?session=+2010…", backLabel: "Adel's chat" } })
// and render <BackLink/> at the top of the destination page. It renders nothing when
// the page was reached directly, so it costs nothing to leave in place.

export function backTrip(to: string, label: string) {
  return { state: { backTo: to, backLabel: label } };
}

export default function BackLink() {
  const loc = useLocation();
  const nav = useNavigate();
  const st = loc.state as { backTo?: string; backLabel?: string } | null;
  if (!st?.backTo) return null;
  return (
    <button
      onClick={() => nav(st.backTo!)}
      className="mb-3 flex cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5 text-xs text-zinc-300 transition hover:border-zinc-600 hover:text-zinc-100"
    >
      <ArrowLeft size={13} aria-hidden="true" />
      Back to {st.backLabel || "where you were"}
    </button>
  );
}
