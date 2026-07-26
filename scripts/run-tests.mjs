// Orchestrates the local POC test suite: spins up the Firestore emulator
// (no real GCP project needed), runs the agent<->Firestore<->vMix relay
// loop test, then the Firestore security-rules test, against it.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnLogged, sleep, waitForPort } from "./lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawnLogged(opts.label || cmd, cmd, args, { cwd: ROOT, ...opts });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function main() {
  console.log("=== starting Firestore emulator ===");
  const emulator = spawnLogged(
    "emulator",
    "npx",
    ["firebase-tools", "emulators:start", "--only", "firestore", "--project", "demo-wetube"],
    { cwd: ROOT }
  );

  let exitCode = 1;
  try {
    await waitForPort(8090, "127.0.0.1", 60000);
    await sleep(1000); // emulator prints ready slightly before fully serving

    console.log("\n=== relay loop test (agent <-> Firestore <-> mock vMix) ===");
    const relayCode = await run("node", ["scripts/test-relay-loop.mjs"], { label: "relay-test" });

    console.log("\n=== Firestore security rules test ===");
    const rulesCode = await run("node", ["scripts/test-firestore-rules.mjs"], { label: "rules-test" });

    exitCode = relayCode === 0 && rulesCode === 0 ? 0 : 1;
    console.log(`\n=== summary: relay=${relayCode === 0 ? "PASS" : "FAIL"}, rules=${rulesCode === 0 ? "PASS" : "FAIL"} ===`);
  } finally {
    emulator.kill();
    await sleep(500);
  }

  process.exit(exitCode);
}

main();
