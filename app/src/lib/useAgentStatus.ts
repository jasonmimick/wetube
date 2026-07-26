"use client";

import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "@/lib/firebaseClient";
import { AGENT_STATUS_DOC } from "@/lib/paths";

export interface AgentStatus {
  lastHeartbeatAt?: string;
  vmixConnected?: boolean;
  streaming?: boolean;
  lastError?: string;
}

const STALE_AFTER_MS = 90_000;

export function useAgentStatus() {
  const [status, setStatus] = useState<AgentStatus | null>(null);

  useEffect(() => {
    const [collection, id] = AGENT_STATUS_DOC.split("/");
    return onSnapshot(doc(db, collection, id), (snap) => {
      setStatus(snap.exists() ? (snap.data() as AgentStatus) : null);
    });
  }, []);

  const online =
    !!status?.lastHeartbeatAt &&
    Date.now() - new Date(status.lastHeartbeatAt).getTime() < STALE_AFTER_MS;

  return { status, online };
}
