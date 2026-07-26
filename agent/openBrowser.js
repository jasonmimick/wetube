const { exec } = require("child_process");

function openBrowser(url) {
  const cmd =
    process.platform === "win32"
      ? `start "" "${url}"`
      : process.platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;

  exec(cmd, (err) => {
    if (err) console.warn("[agent] couldn't auto-open browser:", err.message);
  });
}

module.exports = { openBrowser };
