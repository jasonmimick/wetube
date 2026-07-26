"use client";

import { getApps, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "demo-wetube",
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

// Local dev against the Firebase Local Emulator Suite instead of real
// Firebase infra. Connect calls are idempotent-guarded by a module-level
// flag since Fast Refresh can re-run this file.
declare global {
  // eslint-disable-next-line no-var
  var __wetubeEmulatorsConnected: boolean | undefined;
}

if (
  process.env.NEXT_PUBLIC_USE_EMULATOR === "true" &&
  !globalThis.__wetubeEmulatorsConnected
) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8090);
  globalThis.__wetubeEmulatorsConnected = true;
}
