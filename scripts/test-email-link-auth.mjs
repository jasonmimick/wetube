// Exercises the email-link sign-in path end-to-end against the Auth +
// Firestore emulators — NO real email is ever sent; the Auth emulator
// intercepts sign-in links and exposes them via its own REST API instead.
// Mirrors the logic in app/src/app/api/auth/email-link/claim/route.ts
// (kept in sync by hand, same as agent/agent.js is with paths.ts) since
// that route can't easily be imported standalone outside Next's runtime.

import { initializeApp as initAdminApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";
import { initializeApp as initClientApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth as getClientAuth,
  isSignInWithEmailLink,
  sendSignInLinkToEmail,
  signInWithEmailLink,
} from "firebase/auth";

const PROJECT_ID = "demo-wetube";
const AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8090";
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= AUTH_EMULATOR_HOST;

const TEST_EMAIL = "test+email-link@example.org";
const TEST_ROLE = "controller";
const TEST_NAME = "Test User";

const failures = [];
function check(label, cond) {
  console.log(`${cond ? "OK  " : "FAIL"} ${label}`);
  if (!cond) failures.push(label);
}

async function main() {
  const adminApp = initAdminApp({ projectId: PROJECT_ID });
  const adminAuth = getAdminAuth(adminApp);
  const adminDb = getAdminFirestore(adminApp);

  const clientApp = initClientApp({ apiKey: "fake-api-key", projectId: PROJECT_ID });
  const clientAuth = getClientAuth(clientApp);
  connectAuthEmulator(clientAuth, `http://${AUTH_EMULATOR_HOST}`, { disableWarnings: true });

  console.log(`--- seeding config/emailAccess for ${TEST_EMAIL} ---`);
  await adminDb.doc("config/emailAccess").set({ [TEST_EMAIL]: { role: TEST_ROLE, name: TEST_NAME } });

  console.log("--- sending sign-in link (captured by the emulator, not actually emailed) ---");
  const continueUrl = "http://localhost:3000/";
  await sendSignInLinkToEmail(clientAuth, TEST_EMAIL, { url: continueUrl, handleCodeInApp: true });

  const oobRes = await fetch(`http://${AUTH_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/oobCodes`);
  const { oobCodes } = await oobRes.json();
  const latest = oobCodes.filter((c) => c.email === TEST_EMAIL).at(-1);
  check("emulator captured an oob sign-in link for the test email", Boolean(latest));

  console.log("--- completing sign-in with the captured link ---");
  check("isSignInWithEmailLink recognizes the captured link", isSignInWithEmailLink(clientAuth, latest.oobLink));
  const cred = await signInWithEmailLink(clientAuth, TEST_EMAIL, latest.oobLink);
  check("signed-in user's email matches", cred.user.email === TEST_EMAIL);

  console.log("--- server-side claim step (mirrors the API route) ---");
  const idToken = await cred.user.getIdToken();
  const decoded = await adminAuth.verifyIdToken(idToken);
  check("verifyIdToken resolves the same uid", decoded.uid === cred.user.uid);

  const allowDoc = await adminDb.doc("config/emailAccess").get();
  const entry = allowDoc.data()?.[decoded.email.toLowerCase()];
  check("allowlist entry found for signed-in email", Boolean(entry?.role));

  await adminAuth.setCustomUserClaims(decoded.uid, { role: entry.role, name: entry.name });

  console.log("--- confirming the client picks up the new claim after a token refresh ---");
  const refreshed = await cred.user.getIdTokenResult(true);
  check("refreshed token carries the granted role", refreshed.claims.role === TEST_ROLE);
  check("refreshed token carries the granted name", refreshed.claims.name === TEST_NAME);

  console.log("--- negative case: an email NOT on the allowlist gets no role ---");
  const strangerEmail = "not-authorized@example.org";
  await sendSignInLinkToEmail(clientAuth, strangerEmail, { url: continueUrl, handleCodeInApp: true });
  const oobRes2 = await fetch(`http://${AUTH_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/oobCodes`);
  const { oobCodes: oobCodes2 } = await oobRes2.json();
  const strangerLink = oobCodes2.filter((c) => c.email === strangerEmail).at(-1);
  const strangerCred = await signInWithEmailLink(clientAuth, strangerEmail, strangerLink.oobLink);
  const strangerAllowDoc = await adminDb.doc("config/emailAccess").get();
  const strangerEntry = strangerAllowDoc.data()?.[strangerEmail];
  check("stranger email correctly has no allowlist entry", !strangerEntry);
  check("stranger's token has no role claim (never called setCustomUserClaims)", !(await strangerCred.user.getIdTokenResult()).claims.role);
}

main()
  .then(() => {
    if (failures.length) {
      console.error("\nFAILURES:");
      failures.forEach((f) => console.error(" - " + f));
      process.exitCode = 1;
    } else {
      console.log("\nAll email-link auth tests passed.");
    }
  })
  .catch((err) => {
    console.error("Test script crashed:", err);
    process.exitCode = 1;
  });
