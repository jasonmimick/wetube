// Stand-in "streaming software" for automated testing — no real vMix/OBS
// needed. Set MOCK_FORCE_ERROR=start|stop to make one call throw, to
// exercise the agent's error-handling path in the test loop.

let connected = true;

async function start() {
  if (process.env.MOCK_FORCE_ERROR === "start") {
    throw new Error("mock: forced start failure");
  }
}

async function stop() {
  if (process.env.MOCK_FORCE_ERROR === "stop") {
    throw new Error("mock: forced stop failure");
  }
}

async function checkConnected() {
  return connected;
}

// Test-only escape hatch, not part of the public streamer interface.
function _setConnected(value) {
  connected = value;
}

module.exports = { start, stop, checkConnected, _setConnected };
