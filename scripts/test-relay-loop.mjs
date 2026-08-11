// End-to-end test of the church-PC agent:
//
//   mock wetube API  ->  agent  ->  mock vMix
//        (commands)            (StartStreaming/StopStreaming)
//        <- heartbeat + result <-
//
// Replaces the old Firestore-emulator version. The agent no longer touches
// a database, so this needs no emulator and no JRE — it stands up a tiny
// HTTP server that speaks the same contract as /api/agent/poll and
// /api/agent/result, which makes the test both faster and a much closer
// match to what actually ships.

import http from "node:http";
import { spawnLogged, sleep, waitFor, waitForPort } from "./lib.mjs";

const API_PORT = 5999;
const VMIX_PORT = 8088;
const SECRET = "test-shared-secret";

// ------------------------------------------------ mock wetube API server

const pending = []; // commands the agent hasn't picked up yet
const results = []; // what the agent reported back
let heartbeats = 0;
let lastHeartbeat = null;
let nextCommandId = 1;

function queueCommand(type, massId) {
  const command = { id: nextCommandId++, type, massId, issuedAt: new Date().toISOString(), issuedBy: "test" };
  pending.push(command);
  return command;
}

function readJson(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

const api = http.createServer(async (req, res) => {
  if (req.headers.authorization !== `Bearer ${SECRET}`) {
    res.writeHead(401).end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  const body = await readJson(req);

  if (req.url === "/api/agent/poll") {
    heartbeats += 1;
    lastHeartbeat = body;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ command: pending[0] ?? null }));
    return;
  }

  if (req.url === "/api/agent/result") {
    results.push(body);
    // Consume it, the way consumeCommand() does server-side.
    const idx = pending.findIndex((c) => c.id === body.commandId);
    if (idx >= 0) pending.splice(idx, 1);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(404).end();
});

// ------------------------------------------------------------------ run

let agent;
let mockVmix;
let failed = false;

function check(label, condition) {
  if (condition) {
    console.log(`--- ${label} ---`);
  } else {
    console.error(`!!! FAILED: ${label}`);
    failed = true;
  }
}

try {
  await new Promise((resolve) => api.listen(API_PORT, "127.0.0.1", resolve));
  console.log(`[mock-api] listening on http://127.0.0.1:${API_PORT}`);

  mockVmix = spawnLogged("mock-vmix", "node", ["agent/mock-vmix-server.js"]);
  await waitForPort(VMIX_PORT);

  agent = spawnLogged("agent", "node", ["agent.js"], {
    cwd: "agent",
    env: {
      ...process.env,
      STREAMER: "vmix",
      VMIX_BASE_URL: `http://127.0.0.1:${VMIX_PORT}`,
      WETUBE_APP_URL: `http://127.0.0.1:${API_PORT}`,
      AGENT_SHARED_SECRET: SECRET,
      POLL_INTERVAL_MS: "300",
      AGENT_WEB_PORT: "5757",
      AGENT_NO_AUTO_OPEN: "1",
    },
  });

  await waitFor(() => heartbeats > 0, { timeoutMs: 15000, label: "agent's first heartbeat" });
  check("agent is up and sending heartbeats", true);

  // The heartbeat payload is what drives the app's green LED.
  check(
    "heartbeat reports vMix connected",
    lastHeartbeat?.vmixConnected === true
  );

  for (let i = 1; i <= 3; i++) {
    const startCmd = queueCommand("start", `mass-${i}`);
    await waitFor(() => results.some((r) => r.commandId === startCmd.id && r.ok), {
      timeoutMs: 8000,
      label: `start command ${i} acknowledged`,
    });

    const stopCmd = queueCommand("stop", `mass-${i}`);
    await waitFor(() => results.some((r) => r.commandId === stopCmd.id && r.ok), {
      timeoutMs: 8000,
      label: `stop command ${i} acknowledged`,
    });

    check(`loop ${i}/3 passed (start -> ok -> stop -> ok)`, true);
  }

  // Unreachable vMix: the agent must report the failure rather than
  // silently dropping the command or wedging.
  console.log("--- killing mock vMix to test the unreachable/error path ---");
  mockVmix.kill();
  await sleep(500);

  const failCmd = queueCommand("start", "mass-error");
  await waitFor(
    () => results.some((r) => r.commandId === failCmd.id && r.ok === false && r.error),
    { timeoutMs: 10000, label: "failed start reported with an error" }
  );
  check("unreachable-vMix error path reports failure upstream", true);

  if (failed) throw new Error("one or more assertions failed");
  console.log("All relay-loop tests passed.");
} catch (err) {
  console.error("Relay-loop test FAILED:", err.message);
  failed = true;
} finally {
  agent?.kill();
  mockVmix?.kill();
  api.close();
}

process.exit(failed ? 1 : 0);
