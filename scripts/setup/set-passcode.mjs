// Sets the owner or shared-controller passcode directly in Turso.
//
// This is how Jason bootstraps access — the owner passcode deliberately
// cannot be changed from inside the app, so a stolen owner session can't
// lock him out of his own system.
//
//   node scripts/setup/set-passcode.mjs owner
//   node scripts/setup/set-passcode.mjs controller
//
// Prompts for the passcode with the input hidden. Passing it as an argument
// still works, but prompting is preferred: it keeps the passcode out of
// shell history, and sidesteps shell quoting entirely (a `$` or `!` inside
// double quotes gets silently mangled by the shell, which locks you out
// with a passcode that isn't the one you typed).
//
// Turso credentials are read from the environment, falling back to
// app/.env.local so there's no `set -a; . app/.env.local` incantation to
// remember.
//
// The hash format matches app/src/lib/passcode.ts exactly ("{salt}:{scrypt}"),
// so the app verifies these without any translation.

import { randomBytes, scryptSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeCheatSheet } from "./cheatsheet.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Plaintext cheat sheet, written locally so Jason can look a passcode up
// instead of resetting it. The database only stores a scrypt hash — it
// cannot be reversed — so without this the only recovery is overwriting.
//
// Gitignored (this repo is PUBLIC) and chmod 600. Pass --no-cheatsheet to
// skip writing it.
const CHEATSHEET = join(repoRoot, ".passcodes.local.md");

function loadEnvFallback() {
  if (process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN) return "environment";

  for (const candidate of ["app/.env.local", ".env.local", ".env"]) {
    try {
      const text = readFileSync(join(repoRoot, candidate), "utf8");
      for (const line of text.split("\n")) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
        if (!m) continue;
        const [, k, raw] = m;
        if (process.env[k]) continue;
        process.env[k] = raw.replace(/^["']|["']$/g, "").trim();
      }
      if (process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN) return candidate;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

function promptHidden(question) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error("No terminal available — pass the passcode as an argument instead."));
      return;
    }
    process.stdout.write(question);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    let value = "";
    const onData = (ch) => {
      // Ctrl-C / Ctrl-D
      if (ch === "\u0003" || ch === "\u0004") {
        cleanup();
        process.stdout.write("\n");
        process.exit(1);
      }
      if (ch === "\r" || ch === "\n") {
        cleanup();
        process.stdout.write("\n");
        resolve(value);
        return;
      }
      if (ch === "\u007f" || ch === "\b") {
        value = value.slice(0, -1);
        return;
      }
      value += ch;
    };
    const cleanup = () => {
      process.stdin.removeListener("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    };
    process.stdin.on("data", onData);
  });
}

const argv = process.argv.slice(2);
const noCheatSheet = argv.includes("--no-cheatsheet");
const positional = argv.filter((a) => !a.startsWith("--"));

const role = positional[0];
let passcode = positional[1];
const displayName = positional[2];

if (!role || !["owner", "controller"].includes(role)) {
  console.error(
    "Usage: node scripts/setup/set-passcode.mjs <owner|controller> [passcode] [displayName] [--no-cheatsheet]"
  );
  process.exit(1);
}

const source = loadEnvFallback();
if (!source) {
  console.error(
    "Could not find TURSO_DATABASE_URL / TURSO_AUTH_TOKEN.\n" +
      "Looked in: the environment, app/.env.local, .env.local, .env\n" +
      `(searched under ${repoRoot})`
  );
  process.exit(1);
}
console.log(`Using Turso credentials from: ${source}`);

if (!passcode) {
  passcode = await promptHidden(`New ${role} passcode (typing is hidden): `);
  const confirm = await promptHidden("Confirm: ");
  if (passcode !== confirm) {
    console.error("Passcodes don't match — nothing was changed.");
    process.exit(1);
  }
}

passcode = passcode.trim();
if (!passcode) {
  console.error("Empty passcode — nothing was changed.");
  process.exit(1);
}
if (passcode.length < 6) {
  console.error("Passcode must be at least 6 characters — nothing was changed.");
  process.exit(1);
}

function hashPasscode(value) {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(value, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

const key = role === "owner" ? "owner_passcode" : "controller_passcode";
const value = JSON.stringify({
  hash: hashPasscode(passcode),
  ...(displayName ? { name: displayName } : {}),
});

const endpoint =
  process.env.TURSO_DATABASE_URL.replace(/^libsql:\/\//, "https://").replace(/\/$/, "") + "/v2/pipeline";

const res = await fetch(endpoint, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.TURSO_AUTH_TOKEN}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    requests: [
      {
        type: "execute",
        stmt: {
          sql: `INSERT INTO config (key, value, updated_at) VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
          args: [
            { type: "text", value: key },
            { type: "text", value },
            { type: "text", value: new Date().toISOString() },
          ],
        },
      },
      // Read it straight back, so "it worked" means the row is actually there.
      { type: "execute", stmt: { sql: "SELECT key FROM config ORDER BY key" } },
      { type: "close" },
    ],
  }),
});

if (!res.ok) {
  console.error(`HTTP ${res.status}: ${await res.text()}`);
  process.exit(1);
}

const body = await res.json();
const failed = body.results?.find((r) => r.type === "error");
if (failed) {
  console.error("Failed:", failed.error?.message);
  process.exit(1);
}

const present = body.results[1].response.result.rows.map((r) => r[0].value);
console.log(`✅ ${role} passcode set.`);
console.log(`   config now contains: ${present.join(", ")}`);
if (!present.includes("owner_passcode")) console.log("   ⚠ owner passcode still not set");
if (!present.includes("controller_passcode")) console.log("   ⚠ controller passcode still not set");

if (noCheatSheet) {
  console.log("   (cheat sheet not updated — --no-cheatsheet)");
} else {
  const path = writeCheatSheet(CHEATSHEET, role, passcode);
  console.log(`   cheat sheet updated: ${path} (chmod 600, gitignored)`);
}
