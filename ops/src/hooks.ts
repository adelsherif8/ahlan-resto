import { useEffect, useRef, useState } from "react";

/**
 * Is the tab actually being looked at? Every view polls on a timer, and a console left
 * open on another desktop was hitting flows every 3 seconds forever. Polling is gated on
 * this, so a background tab costs nothing.
 */
export function usePageVisible() {
  const [visible, setVisible] = useState(() => !document.hidden);
  useEffect(() => {
    const on = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return visible;
}

/**
 * Value that lags behind what's typed. The search box wrote to the URL on every
 * keystroke — a history entry and a re-filter per character.
 */
export function useDebounced<T>(value: T, ms = 250) {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setOut(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return out;
}

/**
 * EGP or USD, remembered across tabs and reloads. One setting for the whole console —
 * flipping it on the Cost page and finding Insights still in the other currency would
 * make two pages that should reconcile look like they disagree.
 */
export function useCurrency(): ["EGP" | "USD", (c: "EGP" | "USD") => void] {
  const [cur, setCur] = useState<"EGP" | "USD">(() =>
    (localStorage.getItem("ahlan_ops_currency") as "EGP" | "USD") || "EGP");
  useEffect(() => {
    const on = (e: StorageEvent) => {
      if (e.key === "ahlan_ops_currency" && e.newValue) setCur(e.newValue as "EGP" | "USD");
    };
    addEventListener("storage", on);
    return () => removeEventListener("storage", on);
  }, []);
  return [cur, (c) => { localStorage.setItem("ahlan_ops_currency", c); setCur(c); }];
}

/**
 * "When did I first see this id?" — used to pulse newly arrived rows. Entries are pruned
 * once they can no longer matter, because the plain Map grew for as long as the tab
 * stayed open (one entry per execution ever seen, forever).
 */
export function useFirstSeen(ttlMs = 30_000) {
  const map = useRef<Map<string, number>>(new Map());
  return {
    note(ids: string[]) {
      const now = Date.now();
      for (const id of ids) if (!map.current.has(id)) map.current.set(id, now);
      if (map.current.size > 400) {
        for (const [id, at] of map.current) if (now - at > ttlMs) map.current.delete(id);
      }
    },
    isNew(id: string, withinMs = 12_000) {
      const at = map.current.get(id);
      return !!at && Date.now() - at < withinMs;
    },
  };
}
