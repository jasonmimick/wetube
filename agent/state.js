// In-memory snapshot of the agent's current status, mirroring what's
// written to Firestore — read by webserver.js so someone physically at the
// church PC can see what's going on (and manually override) even if the
// cloud app or network is having problems.

const state = {
  startedAt: new Date().toISOString(),
  streamer: process.env.STREAMER || "mock",
  vmixConnected: null,
  streaming: false,
  lastHeartbeatAt: null,
  lastCommand: null,
  lastError: null,
};

function update(patch) {
  Object.assign(state, patch);
}

function snapshot() {
  return { ...state };
}

module.exports = { update, snapshot };
