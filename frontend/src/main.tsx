import { StrictMode, Suspense, lazy, useEffect, useState, type FC } from "react";
import { createRoot } from "react-dom/client";
import { api, type User } from "./api.ts";
import { PublicSite } from "./PublicSite.tsx";
import { navigate, useRoute } from "./router.ts";
import "./styles.css";
import "./terminal.css";

// The terminal (and its chart/AI libraries) loads only after sign-in.
const Terminal = lazy(() => import("./Terminal.tsx").then((m) => ({ default: m.Terminal })));

// /app/* is the signed-in terminal; everything else is the public site.
// Signing in from a public page lands on /app; visiting /app signed-out
// lands on /login and returns afterwards.
const App: FC = () => {
  const route = useRoute();
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => { api.me().then((r) => setUser(r.user)).catch(() => setUser(null)); }, []);
  const inApp = route.path === "/app" || route.path.startsWith("/app/");

  useEffect(() => {
    if (user === null && inApp) navigate(`/login?next=${encodeURIComponent(route.path + window.location.search)}`, { replace: true });
    if (user && (route.path === "/login" || route.path === "/register")) navigate(safeNext(route.query.get("next")), { replace: true });
  }, [user, inApp, route.path]); // eslint-disable-line react-hooks/exhaustive-deps

  if (user === undefined) return <div className="loading">Loading…</div>;
  if (user && inApp) {
    return <Suspense fallback={<div className="loading">Loading workspace…</div>}>
      <Terminal user={user} onLogout={() => api.logout().finally(() => { setUser(null); navigate("/"); })} />
    </Suspense>;
  }
  return <PublicSite path={route.path} onAuth={(u) => { setUser(u); navigate(safeNext(route.query.get("next"))); }} />;
};

/** Only same-app relative paths are accepted as a post-login destination. */
function safeNext(n: string | null): string {
  return n && /^\/app(\/[a-z]*)?(\?[^#]*)?$/.test(n) ? n : "/app/dashboard";
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
