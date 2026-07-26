// OBS Studio (28+) ships obs-websocket v5 built in — a reasonable stand-in
// for vMix's HTTP API when testing on a Mac, since vMix itself is
// Windows-only. Point a real OBS instance's "WebSocket Server Settings" at
// this and it'll really push RTMP, letting you dry-run the whole pipeline
// against your own personal YouTube channel before touching the church PC.

const crypto = require("crypto");
const WebSocket = require("ws");

const URL = process.env.OBS_WS_URL || "ws://127.0.0.1:4455";
const PASSWORD = process.env.OBS_WS_PASSWORD || "";
const REQUEST_TIMEOUT_MS = 8000;

function computeAuth(password, salt, challenge) {
  const secret = crypto.createHash("sha256").update(password + salt).digest("base64");
  return crypto.createHash("sha256").update(secret + challenge).digest("base64");
}

function request(requestType, requestData) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    let requestId = null;

    const timeout = setTimeout(() => {
      ws.terminate();
      reject(new Error(`OBS request ${requestType} timed out`));
    }, REQUEST_TIMEOUT_MS);

    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());

      if (msg.op === 0) {
        // Hello -> Identify
        const identify = { rpcVersion: 1 };
        if (msg.d.authentication) {
          identify.authentication = computeAuth(
            PASSWORD,
            msg.d.authentication.salt,
            msg.d.authentication.challenge
          );
        }
        ws.send(JSON.stringify({ op: 1, d: identify }));
      } else if (msg.op === 2) {
        // Identified -> issue the actual request
        requestId = crypto.randomUUID();
        ws.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
      } else if (msg.op === 7 && msg.d.requestId === requestId) {
        clearTimeout(timeout);
        ws.close();
        if (msg.d.requestStatus.result) {
          resolve(msg.d.responseData);
        } else {
          reject(new Error(msg.d.requestStatus.comment || `OBS request ${requestType} failed`));
        }
      }
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function start() {
  await request("StartStream");
}

async function stop() {
  await request("StopStream");
}

async function checkConnected() {
  try {
    await request("GetVersion");
    return true;
  } catch {
    return false;
  }
}

module.exports = { start, stop, checkConnected };
