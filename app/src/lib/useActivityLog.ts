"use client";

import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "@/lib/firebaseClient";
import { ACTIVITY_LOG } from "@/lib/paths";

export interface ActivityEntry {
  id: string;
  action: string;
  massId: string;
  byName: string;
  byRole: string;
  at: string;
}

export function useActivityLog(max = 20) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);

  useEffect(() => {
    const q = query(collection(db, ACTIVITY_LOG), orderBy("at", "desc"), limit(max));
    return onSnapshot(q, (snap) => {
      setEntries(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ActivityEntry));
    });
  }, [max]);

  return entries;
}
