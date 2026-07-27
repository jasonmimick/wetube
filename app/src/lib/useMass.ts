"use client";

import { collection, doc, limit, onSnapshot, query, where } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "@/lib/firebaseClient";
import { MASSES } from "@/lib/paths";

export interface Mass {
  id: string;
  title: string;
  visibility: string;
  status: string;
  embedUrl?: string;
  watchUrl?: string;
  youtubeMocked?: boolean;
  lastError?: string;
  createdAt?: string;
}

export function useMass(massId: string | null) {
  const [mass, setMass] = useState<Mass | null>(null);

  useEffect(() => {
    if (!massId) {
      setMass(null);
      return;
    }
    return onSnapshot(doc(db, MASSES, massId), (snap) => {
      setMass(snap.exists() ? ({ id: snap.id, ...snap.data() } as Mass) : null);
    });
  }, [massId]);

  return mass;
}

/**
 * Finds whatever mass is currently not-ended, if any — by querying
 * Firestore directly rather than trusting a device-local pointer (e.g.
 * localStorage). A massId stashed in one browser's localStorage is
 * invisible to every other device, so a mass started on the church
 * laptop would never show as live when checked from a phone. At most one
 * mass should ever be non-ended at a time, so this doesn't need an
 * orderBy (which would require a composite Firestore index).
 */
export function useActiveMass() {
  const [mass, setMass] = useState<Mass | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, MASSES),
      where("status", "in", ["starting", "live", "stopping"]),
      limit(1)
    );
    return onSnapshot(q, (snap) => {
      const first = snap.docs[0];
      setMass(first ? ({ id: first.id, ...first.data() } as Mass) : null);
      setLoading(false);
    });
  }, []);

  return { mass, loading };
}
