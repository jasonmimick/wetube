"use client";

import {
  GoogleAuthProvider,
  signInWithCustomToken,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import { useState } from "react";
import { auth } from "@/lib/firebaseClient";
import { useAgentStatus } from "@/lib/useAgentStatus";
import { useAuthedUser } from "@/lib/useAuthedUser";
import { useMass } from "@/lib/useMass";

const YOUTUBE_CHANNEL_URL =
  process.env.NEXT_PUBLIC_YOUTUBE_CHANNEL_URL ||
  "https://www.youtube.com/channel/UCUtmH7wJ0FawlVbsWhLujSg";

function defaultTitle() {
  const date = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  return `Mass — ${date}`;
}

function ChannelLink() {
  return (
    <a
      href={YOUTUBE_CHANNEL_URL}
      target="_blank"
      className="inline-flex items-center gap-1.5 text-sm text-indigo hover:underline"
    >
      Watch past Masses on our YouTube channel
      <span aria-hidden>→</span>
    </a>
  );
}

function Mark() {
  return (
    <div className="relative h-9 w-9 flex-none rounded-lg bg-gradient-to-br from-indigo to-indigo-deep">
      <span className="absolute inset-0 m-auto h-3 w-3 rounded-full bg-gold" style={{ top: "7px" }} />
    </div>
  );
}

function SignIn() {
  const [name, setName] = useState("");
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
        <Mark />
        <div>
          <h1 className="font-heading text-base font-bold text-indigo-deep">Holy Mother and Child</h1>
          <p className="text-xs tracking-wide text-gray-500 uppercase">Mass Control</p>
        </div>
      </div>

      <button
        onClick={googleSignIn}
        className="w-full rounded-lg bg-indigo px-4 py-2.5 font-semibold text-white shadow-[0_6px_16px_-6px_rgba(86,86,175,0.55)]"
      >
        Sign in with Google (Admin)
      </button>

      <div className="text-center text-sm text-gray-400">— or —</div>

      <form onSubmit={passcodeSignIn} className="space-y-3">
        <input
          className="w-full rounded-lg border border-gray-200 bg-[#fafaff] px-3 py-2.5 focus:border-indigo focus:outline-none"
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <input
          className="w-full rounded-lg border border-gray-200 bg-[#fafaff] px-3 py-2.5 focus:border-indigo focus:outline-none"
          placeholder="Passcode"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          inputMode="numeric"
          required
        />
        <button
          disabled={busy}
          className="w-full rounded-lg bg-indigo-deep px-4 py-2.5 font-semibold text-white disabled:opacity-50"
        >
          Enter as Mass Controller
        </button>
      </form>

      {error && <p className="text-sm text-brick">{error}</p>}

      <div className="border-t border-gray-100 pt-5 text-center">
        <ChannelLink />
      </div>
    </div>
  );
}

function AgentBanner() {
  const { status, online } = useAgentStatus();
  if (online) return null;
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      Agent offline{status?.lastHeartbeatAt ? ` — last seen ${status.lastHeartbeatAt}` : ""}.
      Starting a mass may not work right now.
      {status?.lastError && <div className="mt-1 font-mono text-xs">{status.lastError}</div>}
    </div>
  );
}

function MassControls({ idToken }: { idToken: string }) {
  const [activeMassId, setActiveMassId] = useState<string | null>(
    typeof window !== "undefined" ? localStorage.getItem("activeMassId") : null
  );
  const [title, setTitle] = useState(defaultTitle());
  const [visibility, setVisibility] = useState<"public" | "unlisted" | "private">("public");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mass = useMass(activeMassId);

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
      localStorage.setItem("activeMassId", data.massId);
      setActiveMassId(data.massId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start");
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    if (!activeMassId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/mass/stop", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ massId: activeMassId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to stop");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to stop");
    } finally {
      setBusy(false);
    }
  }

  function endSession() {
    localStorage.removeItem("activeMassId");
    setActiveMassId(null);
  }

  if (!mass || mass.status === "ended") {
    return (
      <div className="space-y-4 rounded-xl border border-gray-100 bg-white p-5 shadow-[0_1px_2px_rgba(32,32,111,0.05)]">
        <h2 className="font-heading font-bold text-indigo-deep">Start a New Mass</h2>
        <div>
          <label className="mb-1 block text-xs font-bold tracking-wide text-gray-500 uppercase">Title</label>
          <input
            className="w-full rounded-lg border border-gray-200 bg-[#fafaff] px-3 py-2.5 focus:border-indigo focus:outline-none"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold tracking-wide text-gray-500 uppercase">Visibility</label>
          <select
            className="w-full rounded-lg border border-gray-200 bg-[#fafaff] px-3 py-2.5 focus:border-indigo focus:outline-none"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as typeof visibility)}
          >
            <option value="public">Public</option>
            <option value="unlisted">Unlisted</option>
            <option value="private">Private</option>
          </select>
        </div>
        <button
          onClick={start}
          disabled={busy}
          className="w-full rounded-lg bg-indigo px-4 py-2.5 font-semibold text-white shadow-[0_6px_16px_-6px_rgba(86,86,175,0.55)] disabled:opacity-50"
        >
          Go
        </button>
        {error && <p className="text-sm text-brick">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-gray-100 bg-white p-5 shadow-[0_1px_2px_rgba(32,32,111,0.05)]">
      <h2 className="font-heading font-bold text-indigo-deep">Current Stream</h2>
      <div className="flex flex-wrap items-center gap-2">
        {mass.status === "live" ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-gold/15 px-2.5 py-1 text-xs font-extrabold tracking-wide text-[#93691f] uppercase">
            <span className="h-1.5 w-1.5 rounded-full bg-gold" />
            Live
          </span>
        ) : (
          <span className="rounded-full bg-gray-100 px-2.5 py-1 font-mono text-xs text-gray-600">{mass.status}</span>
        )}
        {mass.youtubeMocked && (
          <span className="rounded bg-yellow-100 px-2 py-0.5 text-xs text-yellow-800">
            mock mode — no real YouTube credentials configured
          </span>
        )}
      </div>
      {mass.embedUrl && !mass.youtubeMocked && (
        <iframe className="aspect-video w-full rounded-lg" src={mass.embedUrl} allowFullScreen />
      )}
      {mass.watchUrl && (
        <a className="block text-sm text-indigo underline" href={mass.watchUrl} target="_blank">
          {mass.watchUrl}
        </a>
      )}
      <button
        onClick={stop}
        disabled={busy || mass.status === "stopping" || mass.status === "ended"}
        className="w-full rounded-lg border-1.5 border-brick px-4 py-2.5 font-semibold text-brick disabled:opacity-50"
      >
        Stop
      </button>
      {mass.status === "ended" && (
        <button onClick={endSession} className="w-full rounded-lg border border-gray-200 px-4 py-2.5">
          Start Another Mass
        </button>
      )}
      {error && <p className="text-sm text-brick">{error}</p>}
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
    <div className="space-y-3 rounded-xl border border-gray-100 bg-white p-5 shadow-[0_1px_2px_rgba(32,32,111,0.05)]">
      <h2 className="font-heading font-bold text-indigo-deep">Admin</h2>
      <button
        onClick={generate}
        disabled={busy}
        className="w-full rounded-lg border border-gray-200 px-4 py-2.5 font-semibold disabled:opacity-50"
      >
        Generate new Mass Controller passcode
      </button>
      {passcode && (
        <div className="rounded-lg border-1.5 border-dashed border-indigo bg-[#fafaff] p-3 text-center">
          <p className="font-mono text-2xl font-semibold tracking-[0.14em] text-indigo-deep">{passcode}</p>
          <p className="mt-1 text-xs text-gray-500">Share this once — it won&apos;t be shown again.</p>
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
        <p className="text-sm text-gray-500">Ask an admin to grant access.</p>
        <button onClick={() => signOut(auth)} className="rounded-lg border border-gray-200 px-4 py-2">
          Sign out
        </button>
      </div>
    );
  }

  user?.getIdToken().then(setIdToken);

  return (
    <div className="mx-auto mt-8 max-w-md space-y-5 px-4 pb-16">
      <div className="flex items-center gap-3 border-b border-gray-100 pb-4">
        <Mark />
        <div className="min-w-0 flex-1">
          <h1 className="font-heading truncate font-bold text-indigo-deep">Holy Mother and Child</h1>
          <p className="text-xs tracking-wide text-gray-500 uppercase">Mass Control</p>
        </div>
        <button onClick={() => signOut(auth)} className="text-sm whitespace-nowrap text-gray-500 underline">
          Sign out
        </button>
      </div>

      <ChannelLink />

      <AgentBanner />
      {idToken && <MassControls idToken={idToken} />}
      {role === "admin" && idToken && <AdminPanel idToken={idToken} />}
    </div>
  );
}
