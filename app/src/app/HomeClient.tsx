"use client";

import {
  GoogleAuthProvider,
  signInWithCustomToken,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import Image from "next/image";
import { useEffect, useState } from "react";
import { auth } from "@/lib/firebaseClient";
import { useActivityLog } from "@/lib/useActivityLog";
import { useAgentStatus } from "@/lib/useAgentStatus";
import { useAuthedUser } from "@/lib/useAuthedUser";
import { useActiveMass } from "@/lib/useMass";

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function relativeTime(iso: string | undefined, now: number) {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

function clockTime(iso: string | undefined) {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function elapsed(iso: string | undefined, now: number) {
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

function TopBar({ idToken, name, role }: { idToken: string | null; name: string | null; role: string | null }) {
  const { online, loading } = useAgentStatus();
  const agentOk = loading || online;
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
        {idToken && (
          <span className="who">
            <span className="avatar">{initials}</span>
            <span className="who-text">
              <strong>{name}</strong>
              <small>{role}</small>
            </span>
          </span>
        )}
        <ChannelLink />
        <ThemeToggle />
      </div>
    </div>
  );
}

function SignIn() {
  const [name, setName] = useState("");
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("theme");
    document.documentElement.setAttribute("data-theme", stored === "light" ? "light" : "dark");
  }, []);

  async function googleSignIn() {
    setError(null);
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch {
      setError("Google sign-in failed.");
    }
  }

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
      await signInWithCustomToken(auth, data.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-16 max-w-sm space-y-8 px-4">
      <div className="flex items-center gap-3">
        <Image src="/hmc-icon.png" alt="" width={36} height={43} unoptimized />
        <div>
          <h1 className="display text-base" style={{ color: "var(--wood)" }}>Holy Mother and Child</h1>
          <p className="text-xs tracking-wide uppercase" style={{ color: "var(--wood-soft)" }}>Live Stream Control</p>
        </div>
      </div>

      <button onClick={googleSignIn} className="solid-btn">
        Sign in with Google (Admin)
      </button>

      <div className="text-center text-sm" style={{ color: "var(--wood-soft)" }}>— or —</div>

      <form onSubmit={passcodeSignIn} className="space-y-3">
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
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          inputMode="numeric"
          required
        />
        <button disabled={busy} className="ghost-btn" style={{ width: "100%" }}>
          Enter as Stream Controller
        </button>
      </form>

      {error && <p className="text-sm" style={{ color: "var(--danger)" }}>{error}</p>}

      <div className="pt-5 text-center" style={{ borderTop: "1px solid var(--line)" }}>
        <ChannelLink />
      </div>
    </div>
  );
}

function RemoteControl({ idToken }: { idToken: string }) {
  const [title, setTitle] = useState(defaultTitle());
  const [visibility, setVisibility] = useState<"public" | "private">("private");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { mass } = useActiveMass();
  const { status: agentStatus, online, loading } = useAgentStatus();
  const now = useNow();
  const agentOk = loading || online;
  const isLive = !!mass;

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/mass/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ title, visibility }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start");
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
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ massId: mass.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to stop");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to stop");
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

        <div className="leds">
          <div className="led"><span className={`bulb ${agentOk ? "on" : "off"}`} /><small>Agent</small></div>
          <div className="led"><span className={`bulb ${agentStatus?.vmixConnected ? "on" : "off"}`} /><small>vMix</small></div>
          <div className="led"><span className={`bulb ${mass?.status === "live" ? "warn" : "off"}`} /><small>On Air</small></div>
        </div>

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
              <span>Watching on YouTube</span>
              <a href={mass.watchUrl} target="_blank" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                Open stream <ExternalLinkIcon />
              </a>
            </div>
          )}
        </div>
      )}

      {error && <p className="text-sm" style={{ color: "var(--danger)" }}>{error}</p>}
    </div>
  );
}

function HeartbeatMonitor() {
  const { status, online, loading } = useAgentStatus();
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

function ActivityLog() {
  const entries = useActivityLog();
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

function AdminPanel({ idToken }: { idToken: string }) {
  const [passcode, setPasscode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function generate() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/passcode", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const data = await res.json();
      setPasscode(data.passcode);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Admin</h2>
      <p className="sub">Rotate the shared Stream Controller passcode</p>
      <button onClick={generate} disabled={busy} className="ghost-btn" style={{ width: "100%" }}>
        Generate new passcode
      </button>
      {passcode && (
        <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span className="code-pill">{passcode}</span>
          <span className="sub" style={{ margin: 0 }}>Share this once — it won&apos;t be shown again.</span>
        </div>
      )}
    </div>
  );
}

export default function HomeClient() {
  const { status, role, name, user } = useAuthedUser();
  const [idToken, setIdToken] = useState<string | null>(null);

  if (status === "loading") return null;
  if (status === "signed-out") return <SignIn />;

  if (!role) {
    return (
      <div className="mx-auto mt-16 max-w-sm space-y-4 text-center px-4">
        <p>Signed in as {name}, but no role is assigned yet.</p>
        <p className="sub">Ask an admin to grant access.</p>
        <button onClick={() => signOut(auth)} className="ghost-btn">Sign out</button>
      </div>
    );
  }

  user?.getIdToken().then(setIdToken);

  return (
    <div>
      <TopBar idToken={idToken} name={name} role={role === "admin" ? "Admin" : "Stream Controller"} />

      <div className="page-header">
        <div>
          <p className="eyebrow">Holy Mother &amp; Child</p>
          <h1 className="display">Live Stream Remote Control</h1>
        </div>
        <Image className="emblem" src="/hmc-emblem.png" alt="Our Mother of Good Counsel" width={200} height={236} unoptimized />
      </div>

      <main className="app-main">
        <div className="stack">
          {idToken && <RemoteControl idToken={idToken} />}
          {role === "admin" && <ActivityLog />}
        </div>
        <div className="stack">
          {role === "admin" && <HeartbeatMonitor />}
          {role === "admin" && idToken && <AdminPanel idToken={idToken} />}
          <button onClick={() => signOut(auth)} className="ghost-btn" style={{ width: "100%" }}>
            Sign out
          </button>
        </div>
      </main>
    </div>
  );
}
