# Design: Drop Firebase

**Status**: in progress — Turso database provisioned, schema applied.
No app code migrated yet.
**Date**: 2026-08-10
**Trigger**: the church-PC agent hit `8 RESOURCE_EXHAUSTED: Quota exceeded`
on Firestore writes, taking the whole system down mid-day.

## Problem

Two separate problems got conflated by the outage, and it's worth keeping
them apart:

1. **The write rate is a bug.** `agent.js` writes a heartbeat to
   `agent/status` on every poll tick, and `POLL_INTERVAL_MS` defaults to
   3000ms — 28,800 writes/day against a Spark-plan cap of 20,000. Any day
   the church PC stays on longer than ~16.5 hours, the agent exhausts the
   entire project's daily write quota by itself and every write in the
   system starts failing. It survived this long only because the PC used
   to be switched off between Masses.
2. **The vendor is a poor fit.** A hard *daily* cap that takes the whole
   system down until midnight Pacific — with no graceful degradation and
   no warning — is a bad failure mode for something that has to work at a
   fixed time on Sunday morning.

**The heartbeat doesn't need that write rate at all.** `useAgentStatus.ts`
sets `STALE_AFTER_MS = 90_000` — the green "Agent" LED only goes red when
the last heartbeat is 90 seconds old. Writing every 3s to drive an
indicator with a 90s threshold is pure waste:

| Heartbeat interval | Writes/day | Green LED behaviour |
|---|---|---|
| 3s (today) | 28,800 | exceeds free tier, whole system fails |
| 30s | 2,880 | tolerates 2 dropped writes before flickering |
| 60s | 1,440 | tolerates 1 — too tight |

30s is the pick: 10x fewer writes, and the LED is *more* robust than today
because one failed write no longer matters.

**This fix is required regardless of backend.** A 3-second write loop finds
the free-tier wall of any vendor eventually. The write rate is the root
cause; the vendor choice only decides the shape of the failure.

## What Firebase does for us today

### Job 1 — Firestore (datastore + realtime)

| Path | Written by | Read by |
|---|---|---|
| `masses/{massId}` | API routes, agent | browser (`onSnapshot`), API routes |
| `commands/latest` | API routes | agent (poll, every 3s) |
| `agent/status` | agent (every 3s) | browser (`onSnapshot`) |
| `activityLog/{id}` | API routes | browser (`onSnapshot`) |
| `config/passcode` | admin API route | API routes |
| `config/emailAccess` | setup script | API route |

**The realtime layer is not load-bearing.** Every write already goes
through our own API routes via the Admin SDK — `firestore.rules` is
`allow write: if false` on every collection. The browser only ever *reads*
directly, and the agent polls. So live listeners are the only feature
being given up, and one polled endpoint replaces them.

### Job 2 — Firebase Auth

Three sign-in paths landing on an ID token with a `role` custom claim,
verified by `requireRole()` in `lib/authz.ts`: Google popup, email link
(allowlist-gated), and shared passcode via `createCustomToken`.

## Decisions

### Rejected: SQLite embedded in the church-PC executable

Considered seriously, because `node:sqlite` is built into the Node binary
(verified working on Node 26 locally) — there's no native addon, so `pkg`
bundles it with no extra work. `@yao-pkg/pkg-fetch` 3.5.16 tops out at a
node22 target, where `node:sqlite` still needs `--experimental-sqlite`
(passable via `pkg --options`), so this was packageable.

**Rejected because the app is reached over the internet via Vercel.** The
church PC has no public inbound address — that is the entire reason a
cloud datastore exists in the first place. Putting the database on the PC
would force the PC to become the web server, reachable only over church
WiFi or through a tunnel. Jason confirmed volunteers reach the app from
the internet, so the datastore has to be cloud-side.

Recording this so it isn't re-litigated: SQLite on the PC is not wrong,
it's a different product (a LAN appliance instead of an internet app).

### Datastore: Turso (libSQL) — provisioned

SQLite semantics, but cloud-hosted and reachable from Vercel functions.
Row-based free-tier limits fit a heartbeat workload better than Neon's
compute-hour metering, which never lets an always-polled database
autosuspend.

| | |
|---|---|
| Org | `jmimick` (personal, `starter`/free plan) |
| Database | `wetube` |
| Hostname | `wetube-jmimick.aws-us-east-1.turso.io` |
| Group / location | `default` / `aws-us-east-1` (Virginia) |

`aws-us-east-1` matches Vercel's default `iad1` function region. The
Vercel routes are the only direct DB client — the agent polls Vercel over
HTTP and never touches Turso — so that is where latency matters.

Schema lives in `db/001_init.sql`, applied with
`node scripts/db/apply-schema.mjs` (plain `fetch` against Turso's HTTP
pipeline API — no SDK, no driver, no install). Every statement is
`IF NOT EXISTS` / `INSERT OR IGNORE`, so it is idempotent and safe to
re-run. Verified applied.

Two shape changes from Firestore, both deliberate:

- **`commands` is append-only with an autoincrement id**, replacing the
  `commands/latest` single-doc mailbox. The agent tracks the last id it
  processed, which retires the `issuedAt`/`consumedAt` string comparison
  in `tick()` — that relied on lexicographic ISO ordering plus a
  `lastProcessedIssuedAt` guard to survive restarts.
- **`agent_status` is a single row** (`CHECK (id = 1)`), rewritten only
  when a field actually changed or the heartbeat is stale.

### Auth: our own, replacing Firebase Auth entirely

Two roles, two passcodes, no third-party vendor:

- **`owner`** — Jason. Full control including title/visibility curation.
- **`controller`** — volunteers, via the shared passcode.

`lib/passcode.ts` (scrypt + `timingSafeEqual`) is reused **unchanged**;
its `{salt}:{hash}` format is what goes in the `config` table. Sessions
become a stateless signed cookie (HMAC over uid/role/name/expiry with a
server secret), so there's no session table and no lookup on the hot path.
`requireRole()` keeps its exact signature — only its innards change from
`adminAuth.verifyIdToken` to cookie verification — so every call site in
the API routes is untouched.

**Dropped on purpose**: Google sign-in, email-link sign-in, the
`config/emailAccess` allowlist, and `scripts/setup/grant-email-access.mjs`.
Jason explicitly does not want more people signing in with Google. Clerk
was considered (it is the portfolio SOP default) and rejected here: it
cannot mint anonymous role-bearing sessions, so the passcode path — the
one that actually matters for volunteers — would have had to survive
alongside it anyway. Two auth systems to get one working flow is worse
than one small owned flow.

This is a *net reduction* in auth code versus today's three paths.

### Agent: plain HTTP, no SDK, no credentials on the PC

- `GET /api/agent/poll` — returns any unconsumed command **and** records
  the heartbeat in one request. Shared-secret bearer token, same pattern
  as the existing `CRON_SECRET` on `/api/cron/auto-shutoff`.
- `POST /api/agent/result` — report start/stop outcome.

Consequences:

- Two Firestore ops per tick become **one** HTTP request.
- The heartbeat write is throttled **server-side**, so the agent can keep
  polling at 3s for command responsiveness while the DB sees ~30s writes.
  This decouples "feels instant when you hit Go Live" from write volume —
  the coupling that caused the outage.
- No service-account key on a machine volunteers can physically access.
  Revocation becomes "rotate one secret".
- `firebase-admin` leaves the `pkg` bundle entirely, leaving `dotenv` and
  `ws`.

### Realtime: one polled endpoint

`GET /api/state` returns `{ mass, agentStatus, activityLog }`, polled
~5s, replacing all four `onSnapshot` hooks. `HomeClient.tsx:461` already
polls on a 20s interval for the viewer count, so the pattern exists in the
file. SSE is the upgrade path if 5s ever feels slow.

## Migration sequence

Ordered so the parish always has a working system.

1. **Throttle the heartbeat on the current Firestore stack** (30s) and
   shorten the 600s retry timeout — one failed call currently wedges the
   agent for 10 minutes and shows a stale heartbeat rather than a
   rate-limit error. Removes all time pressure from everything below.
   *Firestore stays live until cutover, so this matters during the
   migration, not just before it.*
2. ~~Provision Turso + schema~~ — **done**.
3. Data-access layer (`lib/db.ts`) + dual-write from API routes. Reads
   still from Firestore. Verify across a couple of Masses.
4. Agent → HTTP. Rebuild `wetube-agent-win.exe`, install on the church PC,
   keep the old exe to roll back to.
5. Browser reads → `/api/state`; delete the four `onSnapshot` hooks.
6. Auth swap. Biggest user-visible change — do it alone, mid-week.
7. Delete `firebase`, `firebase-admin`, `firestore.rules`,
   `firestore.indexes.json`, `firebase.json`, the emulator setup in
   `npm test`, and the service-account key.

## What this costs us

- **Realtime out of the box** — polling is a small downgrade at this scale.
- **The emulator.** `npm test` currently spins up the Firestore emulator
  for the agent↔store↔mock-vMix relay test. That becomes a local SQLite
  file, which is *less* setup than the emulator (which needed a JRE) — one
  of the few places this migration simplifies testing rather than
  complicating it.
- **Managed auth.** We own password handling now. Mitigated by the surface
  being two scrypt-hashed passcodes and a signed cookie, with no password
  reset, no email delivery, and no account recovery to get wrong.
- **Migration risk on a live system** a parish depends on at a fixed time
  weekly.

## Open questions

- **Secrets to set** once code lands: `TURSO_DATABASE_URL`,
  `TURSO_AUTH_TOKEN`, `SESSION_SECRET`, `AGENT_SHARED_SECRET` in Vercel;
  the agent needs only `AGENT_SHARED_SECRET` + the app URL. The Turso
  *platform* API token (org-scoped, can create/destroy databases) must
  **not** go to Vercel — only the database-scoped token does.
- **Rotate the Turso platform token** — it was pasted into a chat session
  on 2026-08-10.
- **Does existing Firestore data need backfilling** into Turso, or can
  broadcast history start fresh? Affects whether step 3 needs a migration
  script.
- **No backup story yet** for Turso. Free tier has point-in-time restore
  limits worth checking before this is the only copy of broadcast history.
