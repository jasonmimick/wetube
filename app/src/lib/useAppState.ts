"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface Mass {
  id: string;
  title: string;
  visibility: string;
  status: string;
  embedUrl?: string | null;
  watchUrl?: string | null;
  youtubeMocked?: boolean;
  lastError?: string | null;
  createdAt?: string;
  autoShutoffDisabled?: boolean;
}

export interface AgentStatus {
  lastHeartbeatAt?: string | null;
  vmixConnected?: boolean | null;
  streaming?: boolean;
  lastError?: string | null;
}

export interface ActivityEntry {
  id: string;
  action: string;
  massId: string;
  title?: string;
  watchUrl?: string;
  byName: string;
  byRole: string;
  at: string;
}

const POLL_MS = 5000;

// The agent polls every POLL_INTERVAL_MS — 60s once it's out of the old
// 3s default, which was generating ~28.8k Vercel requests/day to catch two
// masses a week. The server still throttles the heartbeat write to 30s, so
// at a 60s poll a write lands on every poll. 180s leaves room for two
// missed polls before the LED goes red — see docs/DESIGN-drop-firebase.md.
export const STALE_AFTER_MS = 180_000;

/**
 * Single polled endpoint replacing the four Firestore onSnapshot listeners
 * (useMass, useActiveMass, useAgentStatus, useActivityLog). One request
 * every 5s carries the active mass, agent status, and activity log.
 */
export function useAppState() {
  const [mass, setMass] = useState<Mass | null>(null);
  const [agent, setAgent] = useState<AgentStatus | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Avoids overlapping requests if one poll runs long (a cold Vercel
  // function plus a Turso round trip can exceed the 5s interval).
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch("/api/state");
      if (!res.ok) {
        setError(res.status === 401 ? "signed-out" : `state ${res.status}`);
        return;
      }
      const data = await res.json();
      setMass(data.mass ?? null);
      setAgent(data.agent ?? null);
      setActivity(data.activity ?? []);
      setError(null);
    } catch {
      setError("offline");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  // Only poll while the tab is actually visible. A control panel left open
  // in a background tab was costing 17.3k requests/day on its own — more
  // than the church-PC agent does at a 60s poll — for state nobody is
  // looking at. Refreshing on visibilitychange means coming back to the tab
  // is *faster* than the old behaviour, not slower: fresh state immediately
  // instead of waiting out the rest of the 5s interval.
  useEffect(() => {
    refresh();

    const id = setInterval(() => {
      if (!document.hidden) refresh();
    }, POLL_MS);

    const onVisibility = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  const online =
    !!agent?.lastHeartbeatAt &&
    Date.now() - new Date(agent.lastHeartbeatAt).getTime() < STALE_AFTER_MS;

  return { mass, agent, activity, online, loading, error, refresh };
}
