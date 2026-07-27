"use client";

import { doc, onSnapshot } from "firebase/firestore";
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
