// Test entry point. No Firestore emulator, no JRE, no firebase-tools —
// the agent talks HTTP to a mock API, so this runs in seconds.
//
//   npm test
//
// The store test additionally needs TURSO_DATABASE_URL / TURSO_AUTH_TOKEN;
// it's skipped (loudly) when they're absent so `npm test` still works
// offline.

import { spawn } from "node:child_process";

function run(cmd, args, label) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("exit", (code) => {
      console.log(`\n=== ${label}: ${code === 0 ? "PASS" : "FAIL"} ===`);
      resolve(code ?? 1);
    });
  });
}

console.log("=== relay loop test (mock API <-> agent <-> mock vMix) ===");
const relayCode = await run("node", ["scripts/test-relay-loop.mjs"], "relay");

let storeCode = 0;
if (process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN) {
  console.log("\n=== store test (Turso) ===");
  storeCode = await run("node", ["scripts/test-store.mjs"], "store");
} else {
  console.log("\n=== store test: SKIPPED (TURSO_DATABASE_URL / TURSO_AUTH_TOKEN not set) ===");
}

console.log(
  `\n=== summary: relay=${relayCode === 0 ? "PASS" : "FAIL"}, store=${
    process.env.TURSO_DATABASE_URL ? (storeCode === 0 ? "PASS" : "FAIL") : "SKIP"
  } ===`
);

process.exit(relayCode || storeCode);
