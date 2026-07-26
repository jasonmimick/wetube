"use client";

import dynamicImport from "next/dynamic";

// This whole page is inherently browser-only (Firebase Auth state, live
// Firestore listeners) — skip SSR entirely rather than have the server
// try (and fail, without real NEXT_PUBLIC_FIREBASE_* config) to render it.
// `ssr: false` requires being inside a Client Component, hence this thin
// wrapper around the actual page.tsx (a Server Component).
const HomeClient = dynamicImport(() => import("./HomeClient"), { ssr: false });

export default function ClientOnlyHome() {
  return <HomeClient />;
}
