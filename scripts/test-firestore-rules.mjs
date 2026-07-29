// Verifies the Firestore security model itself (firestore.rules), not just
// the app code: volunteers/admins should only be able to read what their
// role permits, and nobody should be able to write directly from the
// browser client (all writes go through Cloud Run's Admin SDK / the agent).

import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

async function main() {
  const failures = [];

  const testEnv = await initializeTestEnvironment({
    projectId: "demo-wetube",
    firestore: {
      host: "127.0.0.1",
      port: 8090,
      rules: fs.readFileSync(path.join(ROOT, "firestore.rules"), "utf8"),
    },
  });

  try {
    // Seed data bypassing rules entirely, as the Admin SDK would.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, "masses", "seed-mass"), { title: "Seed", status: "live" });
      await setDoc(doc(db, "agent", "status"), { lastHeartbeatAt: new Date().toISOString() });
      await setDoc(doc(db, "activityLog", "seed-entry"), { action: "start" });
      await setDoc(doc(db, "config", "passcode"), { hash: "shouldneverbereadable" });
    });

    const check = async (label, promise, expect) => {
      try {
        await (expect === "allow" ? assertSucceeds(promise) : assertFails(promise));
        console.log(`  ok: ${label}`);
      } catch {
        failures.push(label);
      }
    };

    const unauth = testEnv.unauthenticatedContext().firestore();
    const controller = testEnv.authenticatedContext("controller-uid", { role: "controller" }).firestore();
    const admin = testEnv.authenticatedContext("admin-uid", { role: "admin" }).firestore();

    await check("unauthenticated cannot read masses", getDoc(doc(unauth, "masses", "seed-mass")), "deny");
    await check("controller can read masses", getDoc(doc(controller, "masses", "seed-mass")), "allow");
    await check("admin can read masses", getDoc(doc(admin, "masses", "seed-mass")), "allow");
    await check("controller can read agent status", getDoc(doc(controller, "agent", "status")), "allow");

    await check("controller can read activityLog", getDoc(doc(controller, "activityLog", "seed-entry")), "allow");
    await check("admin can read activityLog", getDoc(doc(admin, "activityLog", "seed-entry")), "allow");

    await check("nobody (incl. admin) can read the passcode doc from the client", getDoc(doc(admin, "config", "passcode")), "deny");

    await check(
      "admin cannot write masses directly from the client",
      setDoc(doc(admin, "masses", "seed-mass"), { status: "live" }, { merge: true }),
      "deny"
    );
    await check(
      "controller cannot write commands directly from the client",
      setDoc(doc(controller, "commands", "latest"), { type: "start" }),
      "deny"
    );
  } finally {
    await testEnv.cleanup();
  }

  if (failures.length) {
    console.error("\nFAILURES:");
    failures.forEach((f) => console.error(" - " + f));
    process.exitCode = 1;
  } else {
    console.log("\nAll Firestore rules tests passed.");
  }
}

main();
