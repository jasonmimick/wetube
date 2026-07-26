// Runs on the church PC (or, during dev/testing, wherever you point it).
// Polls Firestore for start/stop commands and drives the configured
// streamer (mock / obs / vmix — see streamers/index.js), reporting a
// heartbeat + status back so the web app knows if this process is alive.
// Also serves a local-only status/control page (webserver.js) for whoever
// is physically at the machine.
//
// See docs/DESIGN-stream-control.md "Reliability & fallback" for why this
// polls rather than holding a persistent connection.

require("dotenv").config();

const { cert, initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const streamer = require("./streamers");
const state = require("./state");
const webserver = require("./webserver");

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 3000);
const MASSES = "masses";
const COMMANDS_DOC = "commands/latest";
const AGENT_STATUS_DOC = "agent/status";

function buildApp() {
  const projectId = process.env.FIREBASE_PROJECT_ID || "demo-wetube";

  if (process.env.FIRESTORE_EMULATOR_HOST) {
    return initializeApp({ projectId });
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    return initializeApp({ credential: cert(serviceAccount), projectId });
  }

  const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyFile) {
    throw new Error(
      "No Firestore credentials configured. Set FIRESTORE_EMULATOR_HOST for local " +
        "testing, or GOOGLE_APPLICATION_CREDENTIALS / FIREBASE_SERVICE_ACCOUNT_JSON in production."
    );
  }
  // gcloud/firebase-admin picks up GOOGLE_APPLICATION_CREDENTIALS itself.
  return initializeApp({ projectId });
}

const db = getFirestore(buildApp());

let lastProcessedIssuedAt = null;
let running = true;

async function heartbeat(extra) {
  const vmixConnected = await streamer.checkConnected().catch(() => false);
  const patch = {
    lastHeartbeatAt: new Date().toISOString(),
    vmixConnected,
    ...extra,
  };
  state.update(patch);
  await db.doc(AGENT_STATUS_DOC).set(patch, { merge: true });
}

async function processCommand(command) {
  const massRef = db.collection(MASSES).doc(command.massId);
  const now = new Date().toISOString();

  try {
    if (command.type === "start") {
      await streamer.start();
      await massRef.set({ status: "live", updatedAt: now }, { merge: true });
      await heartbeat({ streaming: true, lastError: null, lastCommand: `start (${command.massId})` });
      console.log(`[agent] started mass ${command.massId}`);
    } else if (command.type === "stop") {
      await streamer.stop();
      await massRef.set({ status: "ended", updatedAt: now }, { merge: true });
      await heartbeat({ streaming: false, lastError: null, lastCommand: `stop (${command.massId})` });
      console.log(`[agent] stopped mass ${command.massId}`);
    } else {
      console.warn(`[agent] unknown command type: ${command.type}`);
    }
  } catch (err) {
    console.error(`[agent] command ${command.type} failed:`, err.message);
    await massRef.set({ status: "error", lastError: err.message, updatedAt: now }, { merge: true });
    await heartbeat({ lastError: err.message });
  }

  await db.doc(COMMANDS_DOC).set({ consumedAt: now }, { merge: true });
}

async function tick() {
  await heartbeat({});

  const snap = await db.doc(COMMANDS_DOC).get();
  if (snap.exists) {
    const command = snap.data();
    const alreadyConsumed = command.consumedAt && command.consumedAt >= command.issuedAt;
    const alreadyProcessedThisRun =
      lastProcessedIssuedAt && command.issuedAt <= lastProcessedIssuedAt;

    if (command.issuedAt && !alreadyConsumed && !alreadyProcessedThisRun) {
      lastProcessedIssuedAt = command.issuedAt;
      await processCommand(command);
    }
  }
}

async function main() {
  console.log(`[agent] starting — streamer=${process.env.STREAMER || "mock"}, poll=${POLL_INTERVAL_MS}ms`);
  webserver.start({ state, streamer });

  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      console.log(`[agent] received ${sig}, shutting down`);
      running = false;
    });
  }

  while (running) {
    try {
      await tick();
    } catch (err) {
      console.error("[agent] tick failed:", err);
      state.update({ lastError: err.message });
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

main();
