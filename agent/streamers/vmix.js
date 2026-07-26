// vMix's built-in HTTP API (localhost:8088 by default, no config needed on
// vMix's side beyond it running). See docs/DESIGN-stream-control.md.

const BASE_URL = process.env.VMIX_BASE_URL || "http://127.0.0.1:8088";

async function call(fn) {
  const res = await fetch(`${BASE_URL}/api/?Function=${fn}`);
  if (!res.ok) {
    throw new Error(`vMix API call ${fn} failed: HTTP ${res.status}`);
  }
}

async function start() {
  await call("StartStreaming");
}

async function stop() {
  await call("StopStreaming");
}

async function checkConnected() {
  try {
    const res = await fetch(`${BASE_URL}/api/`);
    return res.ok;
  } catch {
    return false;
  }
}

module.exports = { start, stop, checkConnected };
