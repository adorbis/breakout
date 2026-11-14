// Public website: landing, product pages, sign-in and registration.
// Content rule: describe only what Breakout actually does in Release 1 —
// no invented statistics, testimonials, returns or "AI predicts" claims.
import { useEffect, useState, type FC, type FormEvent, type ReactNode } from "react";
import { api, ApiError, type PublicInfo, type User } from "./api.ts";
import { linkTo, navigate } from "./router.ts";

const NAV: [string, string][] = [["/features", "Features"], ["/how-it-works", "How it works"], ["/pricing", "Pricing"], ["/about", "About"], ["/contact", "Contact"]];

const A: FC<{ to: string; className?: string; children: ReactNode }> = ({ to, className, children }) => (
  <a href={to} className={className} onClick={linkTo(to)}>{children}</a>
);

const Header: FC<{ path: string }> = ({ path }) => {
  const [open, setOpen] = useState(false);
  return (
    <header className="site-head">
      <A to="/" className="site-brand"><span className="brand-mark">▲</span> Breakout</A>
      <button className="icon-btn site-menu-btn" aria-expanded={open} aria-label="Menu" onClick={() => setOpen((o) => !o)}>☰</button>
      <nav className={`site-nav${open ? " open" : ""}`} aria-label="Site">
        {NAV.map(([to, label]) => <A key={to} to={to} className={path === to ? "on" : ""}>{label}</A>)}
        <A to="/login" className="btn btn-sm">Sign in</A>
        <A to="/register" className="btn btn-sm btn-primary">Get access</A>
      </nav>
    </header>
  );
};

const Footer: FC = () => (
  <footer className="site-foot">
    <div>
      <div className="site-brand"><span className="brand-mark">▲</span> Breakout</div>
      <p className="muted small">A trader workspace by Adorbis Technology Pvt Ltd.</p>
    </div>
    <nav aria-label="Footer">{NAV.map(([to, label]) => <A key={to} to={to}>{label}</A>)}</nav>
    <p className="muted small site-disclaimer">
      Breakout presents market data and TradeOS intelligence for information. It does not place orders, does not give investment advice,
      and does not guarantee any outcome. Trading in securities and derivatives involves risk of loss.
    </p>
  </footer>
);

// --- pages -----------------------------------------------------------------------------
const FEATURES: { t: string; d: string }[] = [
  { t: "Trading terminal", d: "A dense, keyboard-friendly workspace: collapsible navigation, resizable panels, instrument switcher (press /), and saved layouts." },
  { t: "Charts", d: "Candlesticks with volume, six timeframes, zoom, pan and crosshair, overlays (SMA, EMA, VWAP) and swing-level marking — from the read-only market-data adapter." },
  { t: "Scanner presentation", d: "TradeOS scanner candidates with their verdicts, scores and quality labels exactly as TradeOS returns them, with filters, sorting and search." },
  { t: "Next-candle intelligence", d: "TradeOS's next-candle read per instrument, including its evidence — and its explicit refusal reasons when its inputs are not live." },
  { t: "Position monitoring", d: "WF-08 watchdog state: service health, coverage and any broker books it could not read, separated so an outage never looks like a decision." },
  { t: "Alerts centre", d: "TradeOS alerts mirrored from its alert channel, with search, priority filters and per-user acknowledgement; watchlist mentions become notifications." },
  { t: "AI Chat", d: "A context-aware assistant through Adorbis AI. AI text is always visibly separate from TradeOS output and never presented as a trading decision." },
  { t: "Integration health", d: "Every upstream — TradeOS feeds, alerts, market data, AI — reports connected, stale, degraded, pending or unavailable, in words." },
];

const Home: FC = () => (
  <>
    <section className="hero">
      <div className="hero-copy">
        <p className="eyebrow">Release 1 · early access · read-only</p>
        <h1>A professional trading workspace built on honest data.</h1>
        <p className="lead">
          Breakout brings your charts, watchlists, TradeOS intelligence, alerts and an AI assistant into one terminal —
          and tells you, every time, where each number came from and whether it is current.
        </p>
        <div className="hero-cta">
          <A to="/register" className="btn btn-primary btn-lg">Request access</A>
          <A to="/how-it-works" className="btn btn-lg">How it works</A>
        </div>
      </div>
      <div className="hero-panel" aria-hidden>
        <div className="hp-row"><span className="hp-k">Scanner</span><span className="chip chip-ok"><span className="dot" />Connected</span></div>
        <div className="hp-row"><span className="hp-k">Regime</span><span className="chip chip-warn"><span className="dot" />Stale — beyond source limit</span></div>
        <div className="hp-row"><span className="hp-k">EV gate</span><span className="chip chip-off"><span className="dot" />Not implemented</span></div>
        <div className="hp-row"><span className="hp-k">Market data</span><span className="chip chip-off"><span className="dot" />Not connected</span></div>
        <p className="hp-note">Illustration of status states — not live data.</p>
      </div>
    </section>
    <section className="site-section">
      <h2>Product overview</h2>
      <div className="grid-3">
        <div className="card"><h3>Independent</h3><p>Breakout owns your account, watchlists, layouts, alerts state and AI conversations in its own database.</p></div>
        <div className="card"><h3>Intelligence stays authoritative</h3><p>Scanner verdicts, next-candle reads and watchdog state come from TradeOS and are shown as TradeOS output — never recomputed or overridden.</p></div>
        <div className="card"><h3>Read-only by design</h3><p>Release 1 places no orders. There is no order, modify or cancel path anywhere in Breakout.</p></div>
      </div>
    </section>
    <section className="site-section">
      <h2>Features</h2>
      <div className="grid-4">{FEATURES.slice(0, 4).map((f) => <div key={f.t} className="card"><h3>{f.t}</h3><p>{f.d}</p></div>)}</div>
      <p><A to="/features">All features →</A></p>
    </section>
    <HowItWorksBody />
    <section className="site-section site-cta">
      <h2>Ready to look at the market without guesswork?</h2>
      <A to="/register" className="btn btn-primary btn-lg">Request access</A>
    </section>
  </>
);

const Features: FC = () => (
  <section className="site-section">
    <h1>Features</h1>
    <p className="lead">Everything in Release 1, and nothing that isn't.</p>
    <div className="grid-2">{FEATURES.map((f) => <div key={f.t} className="card"><h3>{f.t}</h3><p>{f.d}</p></div>)}</div>
    <h2>What Breakout deliberately does not do</h2>
    <ul className="checklist">
      <li>Place, modify or cancel broker orders.</li>
      <li>Compute its own trading verdicts, expected value or "signals". Where TradeOS has not built a capability (for example its EV gate), Breakout shows that it is unavailable.</li>
      <li>Present stale or synthetic data as live. Development demo candles are labelled DEMO on every chart.</li>
    </ul>
  </section>
);

const HowItWorksBody: FC = () => (
  <section className="site-section">
    <h2>How it works</h2>
    <ol className="steps">
      <li><b>TradeOS</b> produces the intelligence — scanner, regime, sentiment, next-candle, WF-08 watchdog — and its alerts.</li>
      <li><b>Breakout's integration layer</b> reads it over a private, read-only connection, validates every response against a contract, and tracks each feed's freshness against TradeOS's own limits.</li>
      <li><b>Market data</b> for charts and quotes arrives through a separate read-only adapter in front of OpenAlgo that can only read quotes and history.</li>
      <li><b>Adorbis AI</b> powers the assistant, with the instrument you are looking at as context.</li>
      <li><b>You</b> see one terminal where every panel names its source and time, and where a failed feed says so instead of going blank or guessing.</li>
    </ol>
  </section>
);
const HowItWorks: FC = () => <><HowItWorksBody /><section className="site-section"><h2>Failure is visible, not silent</h2><p>Each integration is its own failure domain. If one engine stops, its panel says "unavailable" with the reason, and everything else keeps working. Service unavailability is never shown as a negative trading decision.</p></section></>;

const Pricing: FC<{ info: PublicInfo | null }> = ({ info }) => (
  <section className="site-section">
    <h1>Pricing</h1>
    <div className="grid-2">
      <div className="card card-plan">
        <h2>Early Access</h2>
        <p className="price">No charge</p>
        <p>{info?.plans[0]?.note ?? "No payment is collected during early access."}</p>
        <ul className="checklist">
          <li>Full trader workspace and watchlists</li><li>TradeOS intelligence presentation</li>
          <li>Alerts centre and notifications</li><li>AI Chat through Adorbis AI</li>
        </ul>
        <A to={info?.registration === "open" ? "/register" : "/contact"} className="btn btn-primary">{info?.registration === "open" ? "Create account" : "Request access"}</A>
      </div>
      <div className="card">
        <h2>Paid plans</h2>
        <p>Not offered yet. Pricing will be published here before any paid plan begins; nobody is billed without choosing a plan.</p>
      </div>
    </div>
  </section>
);

const About: FC = () => (
  <section className="site-section narrow">
    <h1>About</h1>
    <p>Breakout is built by <b>Adorbis Technology Pvt Ltd</b> as an independent trader application on top of three systems:</p>
    <ul className="checklist">
      <li><b>TradeOS</b> — the intelligence and decision authority.</li>
      <li><b>OpenAlgo</b> — broker connectivity and market data, reached read-only.</li>
      <li><b>Adorbis AI</b> — provider-independent AI infrastructure.</li>
    </ul>
    <p>Our principle is simple: a trader should always know what a number is, where it came from, and how old it is. When we don't have something, we say so.</p>
  </section>
);

const Contact: FC = () => {
  const [f, setF] = useState({ name: "", email: "", topic: "access", message: "" });
  const [state, setState] = useState<"idle" | "busy" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setState("busy"); setError(null);
    try { await api.contact(f); setState("sent"); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Could not send."); setState("idle"); }
  };
  return (
    <section className="site-section narrow">
      <h1>Contact</h1>
      {state === "sent" ? <div className="empty"><b>Thank you.</b> Your message has been received by the Breakout team.</div> : (
        <form className="form" onSubmit={submit}>
          <label>Name<input required maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label>Email<input required type="email" maxLength={200} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
          <label>Topic
            <select value={f.topic} onChange={(e) => setF({ ...f, topic: e.target.value })}>
              <option value="access">Early access</option><option value="product">Product question</option>
              <option value="partnership">Partnership</option><option value="support">Support</option><option value="other">Other</option>
            </select>
          </label>
          <label>Message<textarea required minLength={10} maxLength={2000} rows={5} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /></label>
          {error && <div className="field-error" role="alert">{error}</div>}
          <button className="btn btn-primary" disabled={state === "busy"}>{state === "busy" ? "Sending…" : "Send"}</button>
        </form>
      )}
    </section>
  );
};

export const Login: FC<{ onAuth: (u: User) => void }> = ({ onAuth }) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { onAuth((await api.login(username, password)).user); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Could not sign in."); }
    finally { setBusy(false); }
  };
  return (
    <section className="auth-card">
      <h1>Sign in</h1>
      <form className="form" onSubmit={submit}>
        <label>Username<input autoComplete="username" required value={username} onChange={(e) => setUsername(e.target.value)} autoFocus /></label>
        <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {error && <div className="field-error" role="alert">{error}</div>}
        <button className="btn btn-primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
      <p className="muted small">No account? <A to="/register">Get access</A></p>
    </section>
  );
};

const Register: FC<{ info: PublicInfo | null; onAuth: (u: User) => void }> = ({ info, onAuth }) => {
  const [f, setF] = useState({ username: "", password: "", confirm: "", display_name: "", email: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!info) return <div className="loading">Loading…</div>;
  if (info.registration !== "open") {
    return (
      <section className="auth-card">
        <h1>Get access</h1>
        <p>Accounts are created by invitation during early access.</p>
        <A to="/contact" className="btn btn-primary">Request access</A>
        <p className="muted small">Already have an account? <A to="/login">Sign in</A></p>
      </section>
    );
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError(null);
    if (f.password !== f.confirm) { setError("Passwords do not match."); return; }
    setBusy(true);
    try { onAuth((await api.register({ username: f.username, password: f.password, display_name: f.display_name || null, email: f.email || null })).user); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Could not register."); }
    finally { setBusy(false); }
  };
  return (
    <section className="auth-card">
      <h1>Create your account</h1>
      <form className="form" onSubmit={submit}>
        <label>Username<input required pattern="[A-Za-z0-9_.\-]{3,64}" title="3–64 letters, digits, _ . -" autoComplete="username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} /></label>
        <label>Display name <span className="muted">(optional)</span><input maxLength={80} value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} /></label>
        <label>Email <span className="muted">(optional)</span><input type="email" maxLength={200} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        <label>Password<input type="password" required minLength={12} autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>
        <label>Confirm password<input type="password" required minLength={12} autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></label>
        <p className="muted small">At least 12 characters. Breakout is read-only and for information; it is not investment advice.</p>
        {error && <div className="field-error" role="alert">{error}</div>}
        <button className="btn btn-primary" disabled={busy}>{busy ? "Creating…" : "Create account"}</button>
      </form>
    </section>
  );
};

export const PublicSite: FC<{ path: string; onAuth: (u: User) => void }> = ({ path, onAuth }) => {
  const [info, setInfo] = useState<PublicInfo | null>(null);
  useEffect(() => { api.publicInfo().then(setInfo).catch(() => setInfo({ registration: "closed", release: "", read_only: true, plans: [] })); }, []);
  useEffect(() => {
    const titles: Record<string, string> = { "/": "Breakout — trader workspace", "/features": "Features · Breakout", "/how-it-works": "How it works · Breakout",
      "/pricing": "Pricing · Breakout", "/about": "About · Breakout", "/contact": "Contact · Breakout", "/login": "Sign in · Breakout", "/register": "Get access · Breakout" };
    document.title = titles[path] ?? "Breakout";
  }, [path]);
  const page = (() => {
    switch (path) {
      case "/features": return <Features />;
      case "/how-it-works": return <HowItWorks />;
      case "/pricing": return <Pricing info={info} />;
      case "/about": return <About />;
      case "/contact": return <Contact />;
      case "/login": return <Login onAuth={onAuth} />;
      case "/register": return <Register info={info} onAuth={onAuth} />;
      case "/": return <Home />;
      default: return <section className="site-section narrow"><h1>Page not found</h1><p><a href="/" onClick={(e) => { e.preventDefault(); navigate("/"); }}>Back to home</a></p></section>;
    }
  })();
  return <div className="site"><Header path={path} /><main className="site-main">{page}</main><Footer /></div>;
};
