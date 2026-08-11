// Applies db/*.sql to a Turso database over the HTTP pipeline API.
//
// No SDK, no driver, no install step — Turso speaks plain HTTP and Node has
// fetch built in. Run from the repo root:
//
//   TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... node scripts/db/apply-schema.mjs
//
// Every statement is CREATE TABLE / CREATE INDEX ... IF NOT EXISTS or
// INSERT OR IGNORE, so re-running this is safe and idempotent.

import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const url = process.env.TURSO_DATABASE_URL;
const token = process.env.TURSO_AUTH_TOKEN;

if (!url || !token) {
  console.error("Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.");
  process.exit(1);
}

const endpoint = url.replace(/^libsql:\/\//, "https://").replace(/\/$/, "") + "/v2/pipeline";
const dbDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "db");

// Strips comments, then splits on semicolons. Fine for schema files — there
// are no semicolons inside string literals or trigger bodies. If that ever
// changes, this needs a real parser.
function statements(sql) {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function run(sqls) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [...sqls.map((sql) => ({ type: "execute", stmt: { sql } })), { type: "close" }],
    }),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

  const body = await res.json();
  const failed = body.results?.findIndex((r) => r.type === "error");
  if (failed >= 0) {
    const err = body.results[failed].error;
    throw new Error(`statement ${failed + 1} failed: ${err?.message}\n  ${sqls[failed]}`);
  }
  return body.results.filter((r) => r.response?.type === "execute").length;
}

const files = (await readdir(dbDir)).filter((f) => f.endsWith(".sql")).sort();

for (const file of files) {
  const sqls = statements(await readFile(join(dbDir, file), "utf8"));
  const applied = await run(sqls);
  console.log(`${file}: ${applied} statement(s) applied`);
}

console.log("schema up to date");
