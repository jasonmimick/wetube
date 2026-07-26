// Exercises the real relay path end-to-end against the Firestore emulator:
//   this script (standing in for the Next.js API routes) writes
//   masses/{id} + commands/latest
//     -> agent/agent.js polls Firestore, calls the vmix.js HTTP adapter
//     -> mock-vmix-server.js (standing in for a real vMix instance)
//     -> agent writes status + heartbeat back to Firestore
// Runs several start/stop loops, plus one forced-unreachable failure case,
// per docs/DESIGN-stream-control.md's reliability plan.

import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnLogged, sleep, waitFor, waitForPort } from "./lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const AGENT_DIR = path.join(ROOT, "agent");

process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8090";

const db = getFirestore(initializeApp({ projectId: "demo-wetube" }));

async function createMass(title) {
  const ref = db.collection("masses").doc();
  const now = new Date().toISOString();
  await ref.set({ title, visibility: "public", status: "starting", createdAt: now, updatedAt: now });
  return ref;
}

async function issueCommand(type, massId) {
  await db.doc("commands/latest").set({
    type,
    massId,
    issuedAt: new Date().toISOString(),
    issuedBy: "test-harness",
  });
}

async function massStatus(ref) {
  return (await ref.get()).data()?.status;
}

async function agentStatus() {
  return (await db.doc("agent/status").get()).data() || {};
}

async function main() {
  const failures = [];
  const children = [];

  function cleanup() {
    for (const child of children) child.kill();
  }

  try {
    console.log("--- starting mock vMix server ---");
    const mockVmix = spawnLogged("mock-vmix", "node", ["mock-vmix-server.js"], {
      cwd: AGENT_DIR,
      env: { ...process.env, MOCK_VMIX_PORT: "8088" },
    });
    children.push(mockVmix);
    await waitForPort(8088);

    console.log("--- starting agent ---");
    const agent = spawnLogged("agent", "node", ["agent.js"], {
      cwd: AGENT_DIR,
      env: {
        ...process.env,
        STREAMER: "vmix",
        VMIX_BASE_URL: "http://127.0.0.1:8088",
        FIREBASE_PROJECT_ID: "demo-wetube",
        POLL_INTERVAL_MS: "500",
      },
    });
    children.push(agent);

    await waitFor(async () => (await agentStatus()).lastHeartbeatAt, {
      timeoutMs: 15000,
      label: "agent's first heartbeat",
    });
    console.log("--- agent is up and reporting heartbeats ---");

    // --- Loop N: normal start/stop cycles ---
    const LOOPS = 3;
    for (let i = 1; i <= LOOPS; i++) {
      const massRef = await createMass(`Test Mass #${i}`);
      await issueCommand("start", massRef.id);
      await waitFor(async () => (await massStatus(massRef)) === "live", {
        timeoutMs: 8000,
        label: `loop ${i}: mass goes live`,
      });
      if (!(await agentStatus()).streaming) {
        failures.push(`loop ${i}: agent/status.streaming was not true after start`);
      }

      await issueCommand("stop", massRef.id);
      await waitFor(async () => (await massStatus(massRef)) === "ended", {
        timeoutMs: 8000,
        label: `loop ${i}: mass ends`,
      });
      if ((await agentStatus()).streaming) {
        failures.push(`loop ${i}: agent/status.streaming was still true after stop`);
      }
      console.log(`--- loop ${i}/${LOOPS} passed (start -> live -> stop -> ended) ---`);
    }

    // --- Failure path: vMix unreachable ---
    console.log("--- killing mock vMix server to test the unreachable/error path ---");
    mockVmix.kill();
    await sleep(1000); // let a heartbeat tick observe the outage

    if ((await agentStatus()).vmixConnected !== false) {
      failures.push("expected agent/status.vmixConnected to go false once vMix was killed");
    }

    const errorMassRef = await createMass("Test Mass — should error");
    await issueCommand("start", errorMassRef.id);
    await waitFor(async () => (await massStatus(errorMassRef)) === "error", {
      timeoutMs: 8000,
      label: "mass status becomes 'error' when vMix is unreachable",
    });
    const massData = (await errorMassRef.get()).data();
    if (!massData.lastError) {
      failures.push("expected masses/{id}.lastError to be set on failure");
    }
    console.log("--- unreachable-vMix error path passed ---");
  } catch (err) {
    failures.push(err.message);
  } finally {
    cleanup();
  }

  if (failures.length) {
    console.error("\nFAILURES:");
    failures.forEach((f) => console.error(" - " + f));
    process.exitCode = 1;
  } else {
    console.log("\nAll relay-loop tests passed.");
  }
}

main();
