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

// Matches the agent's heartbeat write interval (30s) with room for two
// missed writes before the LED goes red — see docs/DESIGN-drop-firebase.md.
const STALE_AFTER_MS = 90_000;

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

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const online =
    !!agent?.lastHeartbeatAt &&
    Date.now() - new Date(agent.lastHeartbeatAt).getTime() < STALE_AFTER_MS;

  return { mass, agent, activity, online, loading, error, refresh };
}
