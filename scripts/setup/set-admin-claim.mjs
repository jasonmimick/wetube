// One-time bootstrap: grants the 'admin' role to a Google account that has
// already signed into the deployed app at least once (Firebase Auth has to
// know about the user first). See docs/MANUAL_SETUP.md.
//
// Usage (using a service account key):
//   FIREBASE_PROJECT_ID=... GOOGLE_APPLICATION_CREDENTIALS=... \
//     node scripts/setup/set-admin-claim.mjs someone@gmail.com
//
// Or, if you're already `gcloud auth login`'d as an Owner/Editor on the
// project (as is true for the very first bootstrap — no service account
// needed just for this one-time step):
//   FIREBASE_PROJECT_ID=... node scripts/setup/set-admin-claim.mjs someone@gmail.com

import { applicationDefault, cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import fs from "node:fs";

const email = process.argv[2];
if (!email) {
  console.error("Usage: node scripts/setup/set-admin-claim.mjs <email>");
  process.exit(1);
}

function buildApp() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error("Set FIREBASE_PROJECT_ID");

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
  // Falls back to local `gcloud`/`firebase login` Application Default
  // Credentials — fine for this one-time bootstrap if that account already
  // has Owner/Editor on the project.
  return initializeApp({ credential: applicationDefault(), projectId });
}

const auth = getAuth(buildApp());
const user = await auth.getUserByEmail(email);
await auth.setCustomUserClaims(user.uid, { role: "admin", name: user.displayName || email });

console.log(`Granted 'admin' role to ${email} (uid ${user.uid}).`);
console.log("They'll need to sign out and back in (or wait for their token to refresh) to see it take effect.");
