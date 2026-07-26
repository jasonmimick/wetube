// Stands in for a real vMix instance so agent/streamers/vmix.js (the real
// HTTP-call code path, not the trivial mock.js module) can be exercised in
// the local test loop. Mimics just enough of vMix's HTTP API surface:
// GET /api/?Function=StartStreaming, ?Function=StopStreaming, and GET /api/
// for a reachability/status check.

const http = require("http");

const PORT = Number(process.env.MOCK_VMIX_PORT || 8088);
let streaming = false;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname !== "/api/" && url.pathname !== "/api") {
    res.writeHead(404).end();
    return;
  }

  const fn = url.searchParams.get("Function");
  if (fn === "StartStreaming") {
    streaming = true;
    console.log("[mock-vmix] StartStreaming");
  } else if (fn === "StopStreaming") {
    streaming = false;
    console.log("[mock-vmix] StopStreaming");
  }

  res.writeHead(200, { "Content-Type": "text/xml" });
  res.end(`<vmix><streaming>${streaming}</streaming></vmix>`);
});

server.listen(PORT, () => {
  console.log(`[mock-vmix] listening on http://127.0.0.1:${PORT}`);
});
