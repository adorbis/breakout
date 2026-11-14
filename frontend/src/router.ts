// Minimal History-API router. The backend serves index.html for every
// non-API GET, so deep links (/app/chart?symbol=SBIN) survive reloads.
import { useEffect, useState } from "react";

export interface Route { path: string; query: URLSearchParams }

const read = (): Route => ({ path: window.location.pathname.replace(/\/+$/, "") || "/", query: new URLSearchParams(window.location.search) });

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  if (to === window.location.pathname + window.location.search) return;
  window.history[opts.replace ? "replaceState" : "pushState"](null, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
  if (!opts.replace) window.scrollTo(0, 0);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  return route;
}

/** Click handler for in-app anchors: keeps modifier-clicks (new tab) native. */
export function linkTo(to: string) {
  return (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(to);
  };
}
