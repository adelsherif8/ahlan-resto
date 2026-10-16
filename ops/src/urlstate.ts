import { useCallback, useEffect, useState } from "react";

/**
 * Console state lives in the URL hash: `#/flows?flow=respond&exec=r_12&rest=ahlan-pilot`.
 *
 * Why: a trace you are looking at should be a link you can paste, and a refresh
 * (or a redeploy) should put you back where you were. There is no router — the
 * hash is parsed by hand and written with replaceState so filter changes don't
 * spam the back button.
 */
export type UrlState = Record<string, string>;

function parse(): { tab: string; params: UrlState } {
  const raw = location.hash.replace(/^#\/?/, "");
  const [path, qs] = raw.split("?");
  const params: UrlState = {};
  new URLSearchParams(qs || "").forEach((v, k) => { params[k] = v; });
  return { tab: path || "flows", params };
}

function write(tab: string, params: UrlState, push: boolean) {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== "" && v != null) as [string, string][]
  ).toString();
  const hash = `#/${tab}${qs ? `?${qs}` : ""}`;
  if (hash === location.hash) return;
  const url = location.pathname + location.search + hash;
  push ? history.pushState(null, "", url) : history.replaceState(null, "", url);
}

export function useUrl() {
  const [state, setState] = useState(parse);

  useEffect(() => {
    const onPop = () => setState(parse());
    addEventListener("hashchange", onPop);
    addEventListener("popstate", onPop);
    return () => { removeEventListener("hashchange", onPop); removeEventListener("popstate", onPop); };
  }, []);

  /**
   * Switching tabs drops the old tab's params. They are not portable: a leftover `exec`
   * from Flows reopened an unrelated trace after jumping from the Test Chat. Cross-tab
   * jumps call setParams straight after, which merges onto the now-empty set.
   */
  const setTab = useCallback((tab: string) => {
    setState((s) => { write(tab, {}, true); return { ...s, tab, params: {} }; });
  }, []);

  /** Merge params. `push: true` for things worth a back-button entry (opening a trace). */
  const setParams = useCallback((patch: UrlState, push = false) => {
    setState((s) => {
      const params = { ...s.params, ...patch };
      for (const k of Object.keys(params)) if (params[k] === "") delete params[k];
      write(s.tab, params, push);
      return { ...s, params };
    });
  }, []);

  return { tab: state.tab, params: state.params, setTab, setParams };
}
