// Landing page for signed-out visitors: what Breakout is, then sign in.
// Public; no data is fetched, nothing is claimed to be live.
import { useState, type FC, type FormEvent } from "react";
import { api, ApiError } from "./api.ts";

const LoginCard: FC<{ onLogin: (u: string) => void; compact?: boolean }> = ({ onLogin, compact }) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { onLogin((await api.login(username, password)).user.username); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Sign-in failed."); }
    finally { setBusy(false); setPassword(""); }
  };
  return (
    <form className={`login-card${compact ? " login-card-compact" : ""}`} onSubmit={submit}>
      <div className="brand"><span className="brand-mark">▲</span> Breakout</div>
      <label className="field-col">Username<input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required /></label>
      <label className="field-col">Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>
      {error && <div className="field-error" role="alert">{error}</div>}
      <button className="btn btn-primary btn-block" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
    </form>
  );
};

const POINTS: [string, string][] = [
  ["Your trading workspace", "Watchlists, charts, alerts and an AI copilot — one application, your data, your preferences."],
  ["TradeOS is the decision authority", "Scanner verdicts, exit monitoring and intelligence arrive read-only through a validated contract. Breakout displays them; it never re-invents them."],
  ["Honest about what is connected", "Every panel states its source, its age, and when something is unavailable or not yet implemented. No fabricated data, ever."],
  ["No order placement", "Release 1 is read-only with alerts. Breakout cannot place, modify or cancel broker orders."],
];

export const Landing: FC<{ onLogin: (u: string) => void }> = ({ onLogin }) => (
  <div className="landing">
    <header className="landing-top">
      <div className="brand"><span className="brand-mark">▲</span> Breakout</div>
      <span className="muted small">Trader workspace · Release 1</span>
    </header>
    <main className="landing-main">
      <section className="landing-hero">
        <h1>The trader application for the TradeOS era.</h1>
        <p className="landing-sub">
          Breakout is an independent workspace for Indian-market traders. It presents TradeOS intelligence —
          scanner decisions, position monitoring, context — through its own validated integration layer, and keeps
          your watchlists, layouts and preferences entirely yours.
        </p>
        <ul className="landing-points">
          {POINTS.map(([t, d]) => (
            <li key={t}><b>{t}</b><span>{d}</span></li>
          ))}
        </ul>
        <p className="landing-note muted small">
          Status: foundation release. TradeOS intelligence panels appear as soon as the TradeOS-side service
          contract is implemented and credentialed; until then they are labelled explicitly, never faked.
        </p>
      </section>
      <section className="landing-side">
        <LoginCard onLogin={onLogin} />
      </section>
    </main>
    <footer className="landing-foot muted small">
      Read-only by design · Breakout owns its database · TradeOS owns trading intelligence
    </footer>
  </div>
);
