// Runs on the church PC (or, during dev/testing, wherever you point it).
// Polls the wetube web app over plain HTTP for start/stop commands and
// drives the configured streamer (mock / obs / vmix — see streamers/index.js),
// reporting a heartbeat + status back so the web app knows if this process
// is alive. Also serves a local-only status/control page (webserver.js) for
// whoever is physically at the machine — started first, before anything
// else, so a bad/missing config is *visible* on the dashboard instead of
// just crashing the process with no explanation.
//
// No database driver and no cloud credentials live here any more. Before
// 2026-08-10 this process spoke to Firestore directly via firebase-admin,
// which meant a real GCP service-account key sat on a machine volunteers
// can physically access. Now it holds one shared secret and talks only to
// our own API. See docs/DESIGN-drop-firebase.md.

require("dotenv").config();

const streamer = require("./streamers");
const state = require("./state");
const webserver = require("./webserver");
const { openBrowser } = require("./openBrowser");

const APP_URL = (process.env.WETUBE_APP_URL || "").replace(/\/$/, "");
const SHARED_SECRET = process.env.AGENT_SHARED_SECRET || "";

// How often we ask for commands. Kept fast so pressing "Go Live" feels
// instant. This is NOT how often the database is written — the server
// throttles the heartbeat write to ~30s. Coupling those two rates is what
// exhausted the old Firestore quota and took the system down.
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 3000);

// Fail fast rather than hanging. The old Firestore client retried
// internally for 600s, so one bad call wedged this loop for 10 minutes
// while the dashboard showed a stale heartbeat instead of the real error.
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 15000);
const MAX_BACKOFF_MS = Number(process.env.MAX_BACKOFF_MS || 60000);

const WEB_PORT = Number(process.env.AGENT_WEB_PORT || 5757);

let running = true;

function checkConfig() {
  if (!APP_URL) {
    throw new Error(
      "WETUBE_APP_URL is not set. Create a .env file next to this program with " +
        "WETUBE_APP_URL and AGENT_SHARED_SECRET (see docs/MANUAL_SETUP.md)."
    );
  }
  if (!SHARED_SECRET) {
    throw new Error(
      "AGENT_SHARED_SECRET is not set. It must match the value configured in Vercel."
    );
  }
}

async function api(path, body) {
  const res = await fetch(`${APP_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SHARED_SECRET}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${path} -> HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function processCommand(command) {
  const label = `${command.type} (${command.massId})`;
  try {
    if (command.type === "start") {
      await streamer.start();
    } else if (command.type === "stop") {
      await streamer.stop();
    } else {
      console.warn(`[agent] unknown command type: ${command.type}`);
      // Still report it so the command is consumed and doesn't replay forever.
      await api("/api/agent/result", {
        commandId: command.id,
        massId: command.massId,
        type: command.type,
        ok: false,
        error: `unknown command type: ${command.type}`,
      });
      return;
    }

    state.update({
      streaming: command.type === "start",
      lastCommand: label,
      lastError: null,
    });

    await api("/api/agent/result", {
      commandId: command.id,
      massId: command.massId,
      type: command.type,
      ok: true,
    });

    console.log(`[agent] ${command.type === "start" ? "started" : "stopped"} mass ${command.massId}`);
  } catch (err) {
    console.error(`[agent] command ${command.type} failed:`, err.message);
    state.update({ lastError: err.message, lastCommand: `${label} — failed` });

    await api("/api/agent/result", {
      commandId: command.id,
      massId: command.massId,
      type: command.type,
      ok: false,
      error: err.message,
    }).catch((reportErr) => {
      // If we can't even report the failure, the command stays unconsumed
      // and will be retried on a later poll — which is the right outcome.
      console.error("[agent] couldn't report failure:", reportErr.message);
    });
  }
}

async function tick() {
  const vmixConnected = await streamer.checkConnected().catch(() => false);
  const snapshot = state.snapshot();

  // One request does both jobs the old code needed two Firestore round-trips
  // for: record the heartbeat, and fetch any pending command.
  const { command } = await api("/api/agent/poll", {
    vmixConnected,
    streaming: snapshot.streaming,
    lastCommand: snapshot.lastCommand,
    lastError: snapshot.lastError,
  });

  state.update({ lastHeartbeatAt: new Date().toISOString(), vmixConnected });

  if (command) await processCommand(command);
}

async function main() {
  console.log(`[agent] starting — streamer=${process.env.STREAMER || "mock"}, poll=${POLL_INTERVAL_MS}ms`);

  // Dashboard first, unconditionally — so config problems are visible on
  // screen instead of a console window that flashes an error and vanishes.
  webserver.start({ state, streamer });
  if (!process.env.AGENT_NO_AUTO_OPEN) {
    setTimeout(() => openBrowser(`http://127.0.0.1:${WEB_PORT}`), 500);
  }

  try {
    checkConfig();
  } catch (err) {
    console.error("[agent] FAILED TO START:", err.message);
    state.update({ lastError: err.message, vmixConnected: false });
    console.error("[agent] the dashboard is still up so you can see this error:");
    console.error(`[agent]   http://127.0.0.1:${WEB_PORT}`);
    return; // keep the process (and dashboard) alive; nothing to poll
  }

  console.log(`[agent] talking to ${APP_URL}`);

  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      console.log(`[agent] received ${sig}, shutting down`);
      running = false;
    });
  }

  // Back off on repeated failures instead of hammering a backend that's
  // already refusing us.
  let consecutiveFailures = 0;

  while (running) {
    try {
      await tick();
      consecutiveFailures = 0;
    } catch (err) {
      consecutiveFailures += 1;
      console.error(`[agent] tick failed (attempt ${consecutiveFailures}):`, err.message);
      state.update({ lastError: err.message });
    }

    const delay = consecutiveFailures
      ? Math.min(POLL_INTERVAL_MS * 2 ** consecutiveFailures, MAX_BACKOFF_MS)
      : POLL_INTERVAL_MS;
    await new Promise((r) => setTimeout(r, delay));
  }
}

main();
