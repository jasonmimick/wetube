// Verifies the Turso schema and — most importantly — that the server-side
// heartbeat throttle actually suppresses writes.
//
// That throttle is the fix for the 2026-08-10 outage, where the agent wrote
// agent/status every 3s (28,800 writes/day) and exhausted the whole
// project's Firestore quota. If it ever silently stops suppressing, the
// same failure comes back on a different vendor, so it gets a real test.
//
//   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node scripts/test-store.mjs
//
// Operates on the real agent_status row, which is ephemeral heartbeat state
// by definition — the agent overwrites it within seconds of starting.

const url = process.env.TURSO_DATABASE_URL;
const token = process.env.TURSO_AUTH_TOKEN;
if (!url || !token) {
  console.error("Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.");
  process.exit(1);
}

const endpoint = url.replace(/^libsql:\/\//, "https://").replace(/\/$/, "") + "/v2/pipeline";

async function sql(statement, args = []) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [
        {
          type: "execute",
          stmt: {
            sql: statement,
            args: args.map((v) =>
              v === null
                ? { type: "null" }
                : typeof v === "number"
                  ? { type: "integer", value: String(v) }
                  : { type: "text", value: String(v) }
            ),
          },
        },
        { type: "close" },
      ],
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const body = await res.json();
  const err = body.results?.find((r) => r.type === "error");
  if (err) throw new Error(err.error?.message);
  return body.results[0].response.result;
}

let failed = false;
function check(label, condition) {
  if (condition) console.log(`  ok  ${label}`);
  else {
    console.error(`  FAIL  ${label}`);
    failed = true;
  }
}

// The exact statement from app/src/lib/store.ts recordHeartbeat().
const HEARTBEAT_SQL = `UPDATE agent_status
     SET last_heartbeat_at = ?, vmix_connected = ?, streaming = ?,
         last_command = ?, last_error = ?
   WHERE id = 1
     AND (last_heartbeat_at IS NULL
          OR last_heartbeat_at < ?
          OR vmix_connected IS NOT ?
          OR streaming IS NOT ?
          OR last_command IS NOT ?
          OR last_error IS NOT ?)`;

async function heartbeat({ vmix = 1, streaming = 0, cmd = null, err = null, throttleMs = 30_000 } = {}) {
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - throttleMs).toISOString();
  const r = await sql(HEARTBEAT_SQL, [now, vmix, streaming, cmd, err, cutoff, vmix, streaming, cmd, err]);
  return r.affected_row_count;
}

try {
  console.log("schema:");
  const tables = await sql("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
  const names = tables.rows.map((r) => r[0].value);
  for (const t of ["masses", "commands", "agent_status", "activity_log", "config"]) {
    check(`table ${t} exists`, names.includes(t));
  }

  const seed = await sql("SELECT count(*) FROM agent_status WHERE id = 1");
  check("agent_status has exactly one seed row", Number(seed.rows[0][0].value) === 1);

  console.log("\nheartbeat throttle:");

  // Force a known baseline far in the past so the first write always lands.
  await sql(
    "UPDATE agent_status SET last_heartbeat_at = ?, vmix_connected = 1, streaming = 0, last_command = NULL, last_error = NULL WHERE id = 1",
    ["2000-01-01T00:00:00.000Z"]
  );

  check("stale heartbeat writes", (await heartbeat()) === 1);
  check("immediate repeat with identical state is suppressed", (await heartbeat()) === 0);
  check("second repeat also suppressed", (await heartbeat()) === 0);

  // A material change must punch through the throttle immediately — this is
  // what keeps the green LED honest when vMix drops mid-Mass.
  check("changed vmixConnected writes through", (await heartbeat({ vmix: 0 })) === 1);
  check("...and then suppresses again", (await heartbeat({ vmix: 0 })) === 0);
  check("changed streaming writes through", (await heartbeat({ vmix: 0, streaming: 1 })) === 1);
  check("changed lastError writes through", (await heartbeat({ vmix: 0, streaming: 1, err: "boom" })) === 1);
  check("same error suppressed", (await heartbeat({ vmix: 0, streaming: 1, err: "boom" })) === 0);

  // Zero throttle == every call writes, proving the cutoff is what suppresses.
  check("throttleMs=0 always writes", (await heartbeat({ vmix: 0, streaming: 1, err: "boom", throttleMs: 0 })) === 1);

  if (failed) throw new Error("assertions failed");
  console.log("\nAll store tests passed.");
} catch (e) {
  console.error("\nStore test FAILED:", e.message);
  failed = true;
}

process.exit(failed ? 1 : 0);
