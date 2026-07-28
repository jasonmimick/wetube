// Adds (or updates) one entry in the config/emailAccess allowlist that
// gates email-link sign-in (see app/src/app/api/auth/email-link/claim/route.ts).
// Unlike set-admin-claim.mjs, this does NOT require the person to have
// signed in before — it just authorizes the email address for next time
// they use "Have an email invite?" on the sign-in screen.
//
// Usage (using a service account key):
//   FIREBASE_PROJECT_ID=... GOOGLE_APPLICATION_CREDENTIALS=... \
//     node scripts/setup/grant-email-access.mjs someone@example.org controller "Jane Doe"
//
// Role is "admin" or "controller". Against the local emulator instead:
//   FIREBASE_PROJECT_ID=demo-wetube FIRESTORE_EMULATOR_HOST=127.0.0.1:8090 \
//     node scripts/setup/grant-email-access.mjs test@example.org controller "Test User"

import { applicationDefault, cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import fs from "node:fs";

const [, , emailArg, role, name] = process.argv;
if (!emailArg || !role || !name) {
  console.error('Usage: node scripts/setup/grant-email-access.mjs <email> <admin|controller> "<name>"');
  process.exit(1);
}
if (role !== "admin" && role !== "controller") {
  console.error(`Invalid role "${role}" — must be "admin" or "controller".`);
  process.exit(1);
}

const email = emailArg.toLowerCase();

function buildApp() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error("Set FIREBASE_PROJECT_ID");

  if (process.env.FIRESTORE_EMULATOR_HOST) {
    return initializeApp({ projectId });
  }
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return initializeApp({
      credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)),
      projectId,
    });
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const serviceAccount = JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8"));
    return initializeApp({ credential: cert(serviceAccount), projectId });
  }
  return initializeApp({ credential: applicationDefault(), projectId });
}

const db = getFirestore(buildApp());
await db.doc("config/emailAccess").set({ [email]: { role, name } }, { merge: true });

console.log(`Granted '${role}' access to ${email} (${name}).`);
console.log('They can now use "Have an email invite?" on the sign-in screen.');
