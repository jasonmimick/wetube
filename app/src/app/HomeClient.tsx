"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { useAuthedUser } from "@/lib/useAuthedUser";
import {
  useAppState,
  type ActivityEntry,
  type AgentStatus,
  type Mass,
} from "@/lib/useAppState";

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function relativeTime(iso: string | null | undefined, now: number) {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

function clockTime(iso: string | null | undefined) {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function elapsed(iso: string | null | undefined, now: number) {
  if (!iso) return "00:00";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

const YOUTUBE_CHANNEL_URL =
  process.env.NEXT_PUBLIC_YOUTUBE_CHANNEL_URL ||
  "https://www.youtube.com/channel/UCUtmH7wJ0FawlVbsWhLujSg";

function defaultTitle() {
  const now = new Date();
  const date = now.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const label = now.getDay() === 0 ? "Sunday Mass" : "Daily Mass";
  return `${label} — ${date}`;
}

function ExternalLinkIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 17L17 7" />
      <path d="M9 7h8v8" />
    </svg>
  );
}

function ChannelLink() {
  return (
    <a href={YOUTUBE_CHANNEL_URL} target="_blank" className="bar-link">
      Channel <ExternalLinkIcon />
    </a>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const stored = localStorage.getItem("theme");
    const initial = stored === "light" ? "light" : "dark";
    setTheme(initial);
    document.documentElement.setAttribute("data-theme", initial);
  }, []);

  function toggle() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
  }

  return (
    <button className="theme-toggle" type="button" onClick={toggle} aria-label="Toggle light/dark theme">
      {theme === "light" ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M20 14.5A8.5 8.5 0 019.5 4 8.5 8.5 0 1020 14.5z" /></svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
      )}
    </button>
  );
}

function TopBar({
  name,
  role,
  agentOk,
  onSignOut,
}: {
  name: string | null;
  role: string | null;
  agentOk: boolean;
  onSignOut: () => void;
}) {
  const initials = (name || "?")
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="topbar">
      <div className="brand">
        <Image src="/hmc-icon.png" alt="" width={26} height={31} unoptimized />
        <span className="brand-name">Holy Mother &amp; Child</span>
      </div>
      <div className="right">
        {agentOk ? (
          <span className="chip live"><span className="dot" />Agent connected</span>
        ) : (
          <span className="chip off"><span className="dot" />Agent offline</span>
        )}
        {name && (
          <button className="who" onClick={onSignOut} title="Sign out" aria-label={`Signed in as ${name}. Click to sign out.`}>
            <span className="avatar">{initials}</span>
            <span className="who-text">
              <strong>{name}</strong>
              <small>{role}</small>
            </span>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
              <path d="M16 17l5-5-5-5" />
              <path d="M21 12H9" />
            </svg>
          </button>
        )}
        <ChannelLink />
        <ThemeToggle />
      </div>
    </div>
  );
}

function EditIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z" />
    </svg>
  );
}

function StepDevice({
  lcd,
  status,
  hlLcd,
  hlLeds,
  hlPlate,
  hlSwitch,
  hlKnob,
  live,
}: {
  lcd: "standby" | "rec";
  status: string;
  hlLcd?: boolean;
  hlLeds?: boolean;
  hlPlate?: boolean;
  hlSwitch?: boolean;
  hlKnob?: boolean;
  live?: boolean;
}) {
  return (
    <div className="device">
      <div className={`lcd ${lcd}${hlLcd ? " hl" : ""}`}>
        <div className="status">{status}</div>
      </div>
      <div className={`leds${hlLeds ? " hl" : ""}`}><i /><i /></div>
      {lcd === "standby" && (
        <>
          <div className={`plate${hlPlate ? " hl" : ""}`}>
            <div className="line" />
            {hlPlate && <EditIcon />}
          </div>
          <div className={`switch${hlSwitch ? " hl" : ""}`}>
            <span className="on">Private</span><span>Public</span>
          </div>
        </>
      )}
      <div className="knob-row">
        <div className={`knob${live ? " live" : ""}${hlKnob ? " hl" : ""}`} />
      </div>
    </div>
  );
}

/**
 * The only sign-in path now. Google popup and email-link sign-in were both
 * dropped along with Firebase Auth — one shared passcode for volunteers, a
 * separate owner passcode for Jason, and which one you type decides your
 * role. The server sets an httpOnly session cookie, so there's no token for
 * this component to hold onto.
 */
function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [name, setName] = useState("");
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("theme");
    document.documentElement.setAttribute("data-theme", stored === "light" ? "light" : "dark");
  }, []);

  async function passcodeSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/passcode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode, name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Invalid passcode");
      onSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="landing">
      <div style={{ position: "fixed", top: 14, right: 14, zIndex: 10 }}>
        <ThemeToggle />
      </div>
      <header>
        <p className="kicker">Holy Mother &amp; Child</p>
        <h1 className="display">Live Stream Remote Control</h1>
        <p className="sub">Start and stop the Mass livestream right from your phone.</p>
      </header>

      <form onSubmit={passcodeSignIn} className="passcode-form">
        <input
          className="app-input"
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <input
          className="app-input"
          placeholder="Passcode"
          type="password"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          required
        />
        <button disabled={busy} className="primary">
          {busy ? "Checking…" : "Enter"}
        </button>
      </form>

      {error && <p className="text-sm" style={{ color: "var(--danger)", textAlign: "center", marginTop: 10 }}>{error}</p>}

      <div className="divider">How it works</div>

      <div className="steps">
        <div className="step">
          <div className="num">1</div>
          <div className="icon-box"><StepDevice lcd="standby" status="STANDBY" hlLeds /></div>
          <p className="caption">Both lights on?<span>Good to go</span></p>
        </div>
        <div className="step">
          <div className="num">2</div>
          <div className="icon-box"><StepDevice lcd="standby" status="STANDBY" hlPlate /></div>
          <p className="caption">Name it<span>Auto-fills — tap to change</span></p>
        </div>
        <div className="step">
          <div className="num">3</div>
          <div className="icon-box"><StepDevice lcd="standby" status="STANDBY" hlSwitch /></div>
          <p className="caption">Slide the switch<span>Private to test, Public for real</span></p>
        </div>
        <div className="step">
          <div className="num">4</div>
          <div className="icon-box"><StepDevice lcd="standby" status="STANDBY" hlKnob /></div>
          <p className="caption">Press to go live</p>
        </div>
        <div className="step">
          <div className="num">5</div>
          <div className="icon-box"><StepDevice lcd="rec" status="● REC" hlLcd live /></div>
          <p className="caption">You're live<span>Press again when done</span></p>
        </div>
      </div>

      <footer>
        <div className="num done">✓</div>
        <div style={{ marginTop: 14 }}>
          <ChannelLink />
        </div>
      </footer>
    </div>
  );
}

interface BroadcastStats {
  concurrentViewers: number | null;
  totalViews: number | null;
}

// Polls rather than listening live — viewer counts come from the YouTube
// Data API (via our own backend, to keep the OAuth refresh token
// server-side), not Firestore, so there's no realtime listener option.
function useBroadcastStats(massId: string | null) {
  const [stats, setStats] = useState<BroadcastStats>({ concurrentViewers: null, totalViews: null });

  useEffect(() => {
    if (!massId) {
      setStats({ concurrentViewers: null, totalViews: null });
      return;
    }
    let cancelled = false;
    async function poll() {
      try {
        // Session cookie rides along automatically on same-origin fetches —
        // no Authorization header to thread through any more.
        const res = await fetch(`/api/mass/${massId}/stats`);
        if (!res.ok || cancelled) return;
        setStats(await res.json());
      } catch {
        // transient network hiccup — next poll retries
      }
    }
    poll();
    const id = setInterval(poll, 20000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [massId]);

  return stats;
}

function RemoteControl({
  isOwner,
  mass,
  agentStatus,
  agentOk,
  refresh,
}: {
  isOwner: boolean;
  mass: Mass | null;
  agentStatus: AgentStatus | null;
  agentOk: boolean;
  refresh: () => void;
}) {
  const [title, setTitle] = useState(defaultTitle());
  const [visibility, setVisibility] = useState<"public" | "private">("private");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = useNow();
  const isLive = !!mass;
  const stats = useBroadcastStats(isLive ? mass!.id : null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/mass/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, visibility }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start");
      // Poll-based state won't reflect this for up to 5s otherwise, and the
      // button needs to feel immediate.
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start");
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    if (!mass) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/mass/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ massId: mass.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to stop");
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to stop");
    } finally {
      setBusy(false);
    }
  }

  async function disableAutoShutoff() {
    if (!mass) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/mass/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ massId: mass.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to disable auto-shutoff");
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disable auto-shutoff");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="hero-card">
      <div className="remote">
        <span className="model">◉ WT&#8209;1 · Stream Remote</span>

        {isLive ? (
          <div className="lcd rec">
            <div className="status-line"><span className="blink">●</span> REC <span className="tabular">{elapsed(mass?.createdAt, now)}</span></div>
            <div className="sub-line">{mass?.title}</div>
          </div>
        ) : agentOk ? (
          <div className="lcd ready">
            <div className="status-line">STANDBY</div>
            <div className="sub-line">Ready to go live</div>
          </div>
        ) : (
          <div className="lcd dead">
            <div className="status-line">NO SIGNAL</div>
            <div className="sub-line">Church PC unreachable</div>
          </div>
        )}

        <div className="leds">
          <div className="led"><span className={`bulb ${agentOk ? "on" : "off"}`} /><small>Agent</small></div>
          <div className="led"><span className={`bulb ${agentStatus?.vmixConnected ? "on" : "off"}`} /><small>vMix</small></div>
          <div className="led"><span className={`bulb ${mass?.status === "live" ? "warn" : "off"}`} /><small>On Air</small></div>
        </div>

        {!isLive && (
          <>
            <div className="plate">
              <label>Title for next broadcast</label>
              <div className="field-wrap">
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  aria-label="Title for the broadcast that starts when you press Go Live"
                />
                <svg className="edit-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z" />
                </svg>
              </div>
            </div>
            <div className="plate">
              <label>Visibility</label>
              <button
                type="button"
                className="viz-switch"
                data-value={visibility}
                onClick={() => setVisibility((v) => (v === "private" ? "public" : "private"))}
                aria-label={`Visibility: ${visibility === "private" ? "Private" : "Public"}. Click to switch.`}
              >
                <span className="thumb" />
                <span className="opt priv">Private</span>
                <span className="opt pub">Public</span>
              </button>
            </div>
          </>
        )}

        {isLive ? (
          <button className="big-btn live" onClick={stop} disabled={busy || mass?.status === "stopping"}>
            <span className="ring" />Stop
          </button>
        ) : agentOk ? (
          <button className="big-btn ready" onClick={start} disabled={busy}>
            <span className="ring" />Go Live
          </button>
        ) : (
          <button className="big-btn disabled" disabled>
            <span className="ring" />Go Live
          </button>
        )}

        <span className="serial">Holy Mother &amp; Child · Ch. 1</span>
      </div>

      {isLive && (
        <div className="remote-tv">
          {mass?.embedUrl && !mass.youtubeMocked && (
            <div className="video-embed">
              <iframe src={mass.embedUrl} allowFullScreen />
            </div>
          )}
          {mass?.youtubeMocked && (
            <p className="sub" style={{ textAlign: "center" }}>mock mode — no real YouTube credentials configured</p>
          )}
          {mass?.watchUrl && (
            <div className="live-strip">
              <span>
                Watching on YouTube
                {stats.concurrentViewers != null && (
                  <strong style={{ marginLeft: 6 }}>· {stats.concurrentViewers} watching now</strong>
                )}
              </span>
              <a href={mass.watchUrl} target="_blank" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                Open stream <ExternalLinkIcon />
              </a>
            </div>
          )}
          <p className="sub" style={{ textAlign: "center", marginTop: 10, marginBottom: 0 }}>
            {mass?.autoShutoffDisabled
              ? "Auto-shutoff disabled for this broadcast"
              : "Auto-stops after 2 hours unless disabled"}
            {isOwner && !mass?.autoShutoffDisabled && (
              <>
                {" · "}
                <button
                  onClick={disableAutoShutoff}
                  disabled={busy}
                  style={{ background: "none", border: "none", padding: 0, font: "inherit", color: "var(--indigo)", textDecoration: "underline", cursor: "pointer" }}
                >
                  Disable
                </button>
              </>
            )}
          </p>
        </div>
      )}

      {error && <p className="text-sm" style={{ color: "var(--danger)" }}>{error}</p>}
    </div>
  );
}

function HeartbeatMonitor({
  status,
  online,
  loading,
}: {
  status: AgentStatus | null;
  online: boolean;
  loading: boolean;
}) {
  const now = useNow();

  return (
    <div className="card">
      <h2>Heartbeat Monitor</h2>
      <p className="sub">Church PC agent status</p>
      <div className="heartbeat-grid">
        <div className="metric">
          <div className="k">vMix</div>
          <div className={`v ${status?.vmixConnected ? "ok" : "bad"}`}>
            {status?.vmixConnected === undefined ? "—" : status.vmixConnected ? "Connected" : "Disconnected"}
          </div>
        </div>
        <div className="metric">
          <div className="k">Streaming</div>
          <div className="v">{status?.streaming ? "Yes" : "No"}</div>
        </div>
        <div className="metric" style={{ gridColumn: "span 2" }}>
          <div className="k">Last heartbeat</div>
          <div className={`v tabular ${loading || online ? "" : "bad"}`}>
            {relativeTime(status?.lastHeartbeatAt, now)}
            {clockTime(status?.lastHeartbeatAt) && (
              <span style={{ fontWeight: 400, color: "var(--wood-soft)" }}> · {clockTime(status?.lastHeartbeatAt)}</span>
            )}
          </div>
        </div>
      </div>
      {status?.lastError && (
        <p className="code-pill" style={{ marginTop: 12, color: "var(--danger)", display: "block" }}>{status.lastError}</p>
      )}
      {!loading && !online && (
        <p className="sub" style={{ marginTop: 10, marginBottom: 0 }}>
          No heartbeat in over 90s — the church PC agent may be off or unreachable.
        </p>
      )}
    </div>
  );
}

// Kept for future reuse (fine-grained start/stop/override audit trail) —
// no longer rendered directly; see BroadcastHistory below, which condenses
// this same activityLog data down to one row per mass instead of one row
// per action, so it doesn't grow unbounded as usage adds up.
function ActivityLog({ entries }: { entries: ActivityEntry[] }) {
  const now = useNow(30000);

  return (
    <div className="card">
      <h2>Activity Log</h2>
      <p className="sub">Who started or stopped the broadcast</p>
      {entries.length === 0 ? (
        <p className="sub" style={{ marginBottom: 0 }}>Nothing yet.</p>
      ) : (
        <ul className="log">
          {entries.map((e) => (
            <li key={e.id}>
              <span>
                <span className={`action ${e.action}`}>{e.action}</span>{" "}
                {e.title ? (
                  e.watchUrl ? (
                    <a className="title" href={e.watchUrl} target="_blank" rel="noreferrer">{e.title}</a>
                  ) : (
                    <span>{e.title}</span>
                  )
                ) : null}
                <span className="who-name"> by {e.byName}</span>
              </span>
              <time>{relativeTime(e.at, now)}</time>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface HistoryItem {
  id: string;
  title: string;
  watchUrl?: string;
  youtubeMocked: boolean;
  createdByName: string;
  createdAt: string;
  endedAt: string;
  totalViews: number | null;
}

interface HistoryPage {
  items: HistoryItem[];
  nextCursor: string | null;
}

function formatHistoryDate(iso?: string) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatDuration(startIso?: string, endIso?: string) {
  if (!startIso || !endIso) return "";
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (ms <= 0) return "";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

// One row per past mass (start+stop condensed into one line), paginated —
// stays readable even after hundreds of broadcasts, unlike a flat
// per-action log. View counts come from a batched YouTube API call
// server-side (/api/mass/history), not fetched per row.
function BroadcastHistory() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadPage(after: string | null): Promise<HistoryPage> {
    const url = after ? `/api/mass/history?cursor=${encodeURIComponent(after)}` : "/api/mass/history";
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load history");
    return data as HistoryPage;
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadPage(null)
      .then((data) => {
        if (cancelled) return;
        setItems(data.items);
        setCursor(data.nextCursor);
        setHasMore(Boolean(data.nextCursor));
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load history");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    setError(null);
    try {
      const data = await loadPage(cursor);
      setItems((prev) => [...prev, ...data.items]);
      setCursor(data.nextCursor);
      setHasMore(Boolean(data.nextCursor));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load history");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="card">
      <h2>Broadcast History</h2>
      <p className="sub">Past Masses, with final YouTube view counts</p>
      {loading ? (
        <p className="sub" style={{ marginBottom: 0 }}>Loading…</p>
      ) : items.length === 0 ? (
        <p className="sub" style={{ marginBottom: 0 }}>Nothing yet.</p>
      ) : (
        <>
          <ul className="log">
            {items.map((m) => (
              <li key={m.id}>
                <span>
                  {m.watchUrl && !m.youtubeMocked ? (
                    <a className="title" href={m.watchUrl} target="_blank" rel="noreferrer">{m.title}</a>
                  ) : (
                    <span>{m.title}</span>
                  )}
                  <span className="who-name">
                    {" "}
                    · {formatHistoryDate(m.createdAt)}
                    {formatDuration(m.createdAt, m.endedAt) && ` · ${formatDuration(m.createdAt, m.endedAt)}`}
                    {" "}· started by {m.createdByName}
                  </span>
                </span>
                <time className="tabular">
                  {m.youtubeMocked ? "mock" : m.totalViews != null ? `${m.totalViews} views` : "—"}
                </time>
              </li>
            ))}
          </ul>
          {hasMore && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="ghost-btn"
              style={{ width: "100%", marginTop: 10 }}
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          )}
        </>
      )}
      {error && <p className="text-sm" style={{ color: "var(--danger)", marginTop: 10 }}>{error}</p>}
    </div>
  );
}

function AdminPanel() {
  const [passcode, setPasscode] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function setPasscodeOnServer(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/passcode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to set passcode");
      setSaved(passcode);
      setPasscode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set passcode");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Admin</h2>
      <p className="sub">Set the shared Stream Controller passcode</p>
      <form onSubmit={setPasscodeOnServer} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          className="app-input"
          placeholder="New passcode or passphrase"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          style={{ flex: 1, minWidth: 160 }}
          required
        />
        <button disabled={busy} className="ghost-btn">Set</button>
      </form>
      {saved && (
        <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span className="code-pill">{saved}</span>
          <span className="sub" style={{ margin: 0 }}>Now live — share it with volunteers.</span>
        </div>
      )}
      {error && <p className="text-sm" style={{ color: "var(--danger)", marginTop: 10 }}>{error}</p>}
    </div>
  );
}

export default function HomeClient() {
  const { status, role, name, refresh: refreshAuth, signOut } = useAuthedUser();

  // One poller for the whole screen. The Firestore version had three
  // components each opening their own listener; with polling that would be
  // three independent request loops, so state is lifted here and passed down.
  const { mass, agent, online, loading, refresh } = useAppState();

  if (status === "loading") return null;
  if (status === "signed-out") return <SignIn onSignedIn={refreshAuth} />;

  const isOwner = role === "owner";

  // Treated as connected until the first poll lands, so the UI doesn't flash
  // "Agent offline" on every page load.
  const agentOk = loading || online;

  return (
    <div>
      <TopBar
        name={name}
        role={isOwner ? "Owner" : "Stream Controller"}
        agentOk={agentOk}
        onSignOut={signOut}
      />

      <div className="page-header">
        <div>
          <p className="eyebrow">Holy Mother &amp; Child</p>
          <h1 className="display">Live Stream Remote Control</h1>
        </div>
        <Image className="emblem" src="/hmc-emblem.png" alt="Our Mother of Good Counsel" width={200} height={236} unoptimized />
      </div>

      <main className="app-main">
        <div className="stack">
          <RemoteControl
            isOwner={isOwner}
            mass={mass}
            agentStatus={agent}
            agentOk={agentOk}
            refresh={refresh}
          />
          <BroadcastHistory />
        </div>
        <div className="stack">
          {isOwner && <HeartbeatMonitor status={agent} online={online} loading={loading} />}
          {isOwner && <AdminPanel />}
        </div>
      </main>
    </div>
  );
}
