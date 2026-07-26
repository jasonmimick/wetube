import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

function buildApp() {
  const existing = getApps();
  if (existing.length) return existing[0];

  const projectId = process.env.FIREBASE_PROJECT_ID || "demo-wetube";

  // Local dev against the Firestore emulator: no real credentials needed.
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    return initializeApp({ projectId });
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    return initializeApp({ credential: cert(serviceAccount), projectId });
  }

  // Falls back to Application Default Credentials (e.g. Cloud Run's
  // attached service account in production).
  return initializeApp({ credential: applicationDefault(), projectId });
}

const app = buildApp();

export const adminDb = getFirestore(app);
export const adminAuth = getAuth(app);
