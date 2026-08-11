// Sets the owner or shared-controller passcode directly in Turso.
//
// This is how Jason bootstraps access — the owner passcode deliberately
// cannot be changed from inside the app, so a stolen owner session can't
// lock him out of his own system.
//
//   TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... \
//     node scripts/setup/set-passcode.mjs owner "some pass phrase"
//   ... node scripts/setup/set-passcode.mjs controller "volunteer code"
//
// The hash format matches app/src/lib/passcode.ts exactly ("{salt}:{scrypt}"),
// so the app verifies these without any translation.

import { randomBytes, scryptSync } from "node:crypto";

const [, , roleArg, passcodeArg, nameArg] = process.argv;

if (!roleArg || !passcodeArg || !["owner", "controller"].includes(roleArg)) {
  console.error('Usage: node scripts/setup/set-passcode.mjs <owner|controller> "<passcode>" [displayName]');
  process.exit(1);
}

const url = process.env.TURSO_DATABASE_URL;
const token = process.env.TURSO_AUTH_TOKEN;
if (!url || !token) {
  console.error("Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.");
  process.exit(1);
}

function hashPasscode(passcode) {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(passcode, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

const key = roleArg === "owner" ? "owner_passcode" : "controller_passcode";
const value = JSON.stringify({
  hash: hashPasscode(passcodeArg),
  ...(nameArg ? { name: nameArg } : {}),
});

const endpoint = url.replace(/^libsql:\/\//, "https://").replace(/\/$/, "") + "/v2/pipeline";

const res = await fetch(endpoint, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
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

console.log(`${roleArg} passcode set.`);
