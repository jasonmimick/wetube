// Local-only status/control page for whoever is physically at the church
// PC. Bound to 127.0.0.1 so it's never reachable over the network — that's
// the trust boundary, not authentication.

const fs = require("fs");
const http = require("http");
const path = require("path");

const PORT = Number(process.env.AGENT_WEB_PORT || 5757);
const statusHtmlPath = path.join(__dirname, "status.html");

function start({ state, streamer }) {
  const server = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(fs.readFileSync(statusHtmlPath));
      return;
    }

    if (req.method === "GET" && req.url === "/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(state.snapshot()));
      return;
    }

    if (req.method === "POST" && (req.url === "/start" || req.url === "/stop")) {
      const action = req.url === "/start" ? "start" : "stop";
      try {
        await streamer[action]();
        state.update({
          streaming: action === "start",
          lastCommand: `${action} (manual, local)`,
          lastError: null,
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        state.update({ lastError: err.message });
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
      return;
    }

    res.writeHead(404).end();
  });

  // Without this, a stale agent still holding the port makes the new process
  // die on an unhandled 'error' event — which defeats the entire reason the
  // dashboard starts first (so problems are *visible* rather than a console
  // window that flashes and vanishes). Warn and carry on instead: polling
  // still works, only the local status page is unavailable.
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `[agent] local status page unavailable — port ${PORT} is already in use ` +
          `(another agent still running?). Continuing without it.`
      );
    } else {
      console.error("[agent] local status page failed:", err.message);
    }
  });

  server.listen(PORT, "127.0.0.1", () => {
    console.log(`[agent] local status page: http://127.0.0.1:${PORT}`);
  });

  return server;
}

module.exports = { start };
