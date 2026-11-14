import { StrictMode, useEffect, useState, type FC } from "react";
import { createRoot } from "react-dom/client";
import { api } from "./api.ts";
import { Landing } from "./Landing.tsx";
import { Workspace } from "./Workspace.tsx";
import "./styles.css";

const App: FC = () => {
  const [user, setUser] = useState<string | null | undefined>(undefined);
  useEffect(() => { api.me().then((r) => setUser(r.user.username)).catch(() => setUser(null)); }, []);
  if (user === undefined) return <div className="loading">Loading…</div>;
  if (user === null) return <Landing onLogin={setUser} />;
  return <Workspace username={user} onLogout={() => api.logout().finally(() => setUser(null))} />;
};

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
