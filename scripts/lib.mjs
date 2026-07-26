import { spawn } from "node:child_process";
import net from "node:net";
import { setTimeout as sleep } from "node:timers/promises";

export { sleep };

export function waitForPort(port, host = "127.0.0.1", timeoutMs = 20000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect(port, host);
      socket.once("connect", () => {
        socket.end();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timed out waiting for ${host}:${port}`));
        } else {
          setTimeout(attempt, 300);
        }
      });
    };
    attempt();
  });
}

export async function waitFor(fn, { timeoutMs = 10000, intervalMs = 200, label = "condition" } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return;
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

export function spawnLogged(label, cmd, args, opts = {}) {
  const child = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (d) =>
    d
      .toString()
      .split("\n")
      .filter(Boolean)
      .forEach((line) => console.log(`[${label}] ${line}`))
  );
  child.stderr.on("data", (d) =>
    d
      .toString()
      .split("\n")
      .filter(Boolean)
      .forEach((line) => console.error(`[${label}] ${line}`))
  );
  return child;
}
