import { useEffect, useRef } from "react";

// Polling that stops when nobody is looking.
//
// Staff leave the dashboard open all shift on a tablet that's face-down half the time, and
// every page here polls. A hidden tab was still pulling the orders table every few seconds,
// which is pure Supabase egress for pixels no one can see — the single largest avoidable
// cost in the app.
//
// On becoming visible again it fires immediately, so coming back to the tab shows fresh
// data rather than waiting out the remainder of an interval.
export function usePoll(fn: () => void, ms: number, deps: any[] = []) {
  const saved = useRef(fn);
  saved.current = fn;

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    const start = () => { stop(); timer = setInterval(() => saved.current(), ms); };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") stop();
      else { saved.current(); start(); }   // catch up the moment they look again
    };

    saved.current();
    if (document.visibilityState !== "hidden") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => { stop(); document.removeEventListener("visibilitychange", onVisibility); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, ...deps]);
}
