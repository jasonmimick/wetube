# wetube

Automates starting/stopping the YouTube livestream of church masses, which
run through vMix on a Windows laptop at the church. A web app lets any
authorized volunteer start/stop the stream from a phone (no VPN, no
software install on their end), while the owner can still curate the
YouTube broadcast title/visibility. Also covers basic vMix troubleshooting
controls (mic mute).

## Docs

- [docs/DESIGN-stream-control.md](docs/DESIGN-stream-control.md) — original
  architecture, UX flow, auth model, reliability plan. **Note**: its hosting
  and data-layer sections are superseded by DESIGN-drop-firebase.md below.
- [docs/DESIGN-drop-firebase.md](docs/DESIGN-drop-firebase.md) — the
  migration off Firebase (Firestore → Turso, Firebase Auth → our own
  passcode sessions, agent → plain HTTP), written after the 2026-08-10
  Firestore quota outage. **This is the current architecture.**
- [docs/MANUAL_SETUP.md](docs/MANUAL_SETUP.md) — the manual, credentialed
  steps a human has to do (YouTube OAuth, church-PC agent install) that
  can't be scripted from a sandbox.

## Architecture in one paragraph

The Next.js app on Vercel is the only thing that touches the database
(Turso/libSQL). The church-PC agent holds no credentials beyond one shared
secret and never speaks SQL — it polls `POST /api/agent/poll` every ~3s,
which returns any pending command and records its heartbeat in the same
request, then reports the outcome to `POST /api/agent/result`. The browser
polls `GET /api/state` every 5s for the active mass, agent status, and
activity log. Auth is a signed httpOnly session cookie issued by
`/api/auth/passcode`; there is no third-party auth vendor.

## Layout

Three separate deployables, each with its own `package.json`/`node_modules`,
plus root-level dev/test tooling:

- `app/` — Next.js (App Router, TS) control panel. Deploys to **Vercel**
  (GitHub integration — `git push origin master` triggers a production
  build automatically; never run `vercel --prod` manually).
- `agent/` — plain Node.js process that runs **on the church PC**. Polls
  the web app over HTTPS for start/stop commands and drives vMix's local
  HTTP API (or OBS/mock, via a pluggable adapter — see `agent/streamers/`).
  Serves a local-only status/control page (`agent/webserver.js` +
  `status.html`, 127.0.0.1:5757). Ships to the church PC as a single
  executable built with `@yao-pkg/pkg` (`npm run build:win`), not a Node.js
  install. Dependencies are just `dotenv` and `ws`.
- `db/` — SQL schema, applied with `npm run db:schema`.
- `scripts/` — dev/test tooling only (not deployed): the test suite
  (`npm test` from repo root) and one-off setup helpers in `scripts/setup/`.

## Commands

```
npm test                  # from repo root: agent relay test (mock API <->
                          # agent <-> mock vMix). Runs in seconds, needs no
                          # emulator and no JRE. Add TURSO_* env vars to also
                          # run the store/throttle test.
npm run db:schema         # apply db/*.sql to Turso (idempotent)
cd app && npm run build   # type-check + build the Next.js app
cd app && npm run dev     # local dev server (reads app/.env.local)
cd agent && npm start     # run the agent (see agent/.env.example for config)
cd agent && npm run build:win   # build dist/wetube-agent-win.exe for the church PC
```

Bootstrap passcodes (owner passcode deliberately cannot be set from inside
the app, so a stolen owner session can't lock Jason out):

```
TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... \
  node scripts/setup/set-passcode.mjs owner "<pass phrase>" "Jason"
TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... \
  node scripts/setup/set-passcode.mjs controller "<volunteer code>"
```

## Data layer

Turso (libSQL — SQLite semantics, cloud-hosted, reachable from Vercel).

| | |
|---|---|
| Org / database | `jmimick` / `wetube` |
| Hostname | `wetube-jmimick.aws-us-east-1.turso.io` |
| Location | `aws-us-east-1`, matching Vercel's default `iad1` |

Tables: `masses`, `commands`, `agent_status`, `activity_log`, `config`.
All access goes through `app/src/lib/store.ts` — routes never write SQL
directly, so the data layer stays swappable.

Env vars (Vercel): `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`,
`SESSION_SECRET`, `AGENT_SHARED_SECRET`, `CRON_SECRET`. The agent needs
only `WETUBE_APP_URL` + `AGENT_SHARED_SECRET`.

**The Turso *platform* API token is not the same as the database token.**
The platform token is org-scoped and can create/destroy databases — it
belongs nowhere near Vercel. Only the database-scoped token goes in
`TURSO_AUTH_TOKEN`.

## Auth

Two roles, two passcodes, no vendor:

- **`owner`** (Jason) — everything, including auto-shutoff override and
  rotating the volunteer passcode.
- **`controller`** (volunteers) — start/stop only.

Which passcode you type decides your role. Sessions are stateless signed
cookies (`app/src/lib/session.ts`) — HMAC over uid/role/name/expiry, 30-day
expiry, httpOnly. `requireRole()` in `lib/authz.ts` keeps the same
signature it had under Firebase, so route call sites were untouched by the
migration.

Google sign-in, email-link sign-in, and the `config/emailAccess` allowlist
were all **deliberately removed** — Jason explicitly did not want more
people signing in with Google.

## Design system (app/)

The control UI is built around the parish's own devotional icon — *Our
Mother of Good Counsel* (`app/public/hmc-icon.png` small crop,
`hmc-emblem.png` larger crop) — rather than generic styling. Key decisions,
so a future redesign doesn't have to rediscover them:

- **Dark-first, not light-first.** `globals.css` defines the dark palette
  directly in `:root` (unconditional default) and the light palette under
  `:root[data-theme="light"]`. This was deliberate: gating the dark theme
  behind `prefers-color-scheme` meant most users never saw it. The toggle
  button in the top bar flips `data-theme` on `<html>` and persists to
  `localStorage`.
- **Fonts**: Fraunces (display/headlines) + Manrope (everything else), both
  via `next/font/google` in `layout.tsx` — exposed as `--font-display` /
  `--font-body` and consumed in `globals.css`. Georgia/system-serif reads as
  dated; don't revert to it.
- **The stream control card is a stylized physical remote control**
  (`.remote` in `globals.css`, `RemoteControl` in `HomeClient.tsx`) — LCD
  status readout (STANDBY / REC + elapsed time / NO SIGNAL), a slide switch
  for Private/Public visibility (defaults to **Private**, no Unlisted
  option — removed on purpose, not an oversight), a big circular Go
  Live/Stop button, and status LEDs (Agent/vMix/On Air). This was an
  explicit design pivot away from a generic card-based dashboard look.
- **No fake/decorative data.** An earlier draft had a sparkline chart on the
  heartbeat monitor; it was dropped before shipping because there's no real
  historical heartbeat time-series stored anywhere — a fake chart on a
  live operational monitor for a real broadcast system would be actively
  misleading.
- Design was iterated as a shareable Claude Artifact mockup first, then
  ported into the real app once approved — see git log around "Redesign
  control UI" for the before/after.
- **State is polled once, at the top.** `HomeClient` calls `useAppState()`
  a single time and passes `mass`/`agent`/`online` down as props. Don't
  reintroduce per-component data hooks — under the old Firestore listeners
  that cost nothing, but with polling each one becomes its own request loop.

## Gotchas

- **The heartbeat write rate is the thing that broke production once.**
  On 2026-08-10 the agent wrote its status on every 3s poll — 28,800
  writes/day against Firestore's 20,000/day free cap — and exhausted the
  entire project's quota, failing *every* write in the system until
  midnight Pacific. It reads like a church-PC or credentials problem and is
  neither. The fix is structural: the agent still polls at 3s for
  responsiveness, but the heartbeat DB write is throttled **server-side**
  in `/api/agent/poll` (~30s, or immediately on a material change). The app
  only marks the agent stale after 90s, so this drives the green LED just
  as accurately at 1/10th the cost. `scripts/test-store.mjs` asserts the
  throttle actually suppresses writes — keep that test passing.
- **A stray `app/app/` directory silently breaks Next.js route discovery.**
  If a shell command runs from inside `app/` while you think you're at the
  repo root, `mkdir -p app/src/...` creates a nested `app/app/src/...` —
  and its mere *existence* makes Next.js treat `app/app` as the App Router
  root instead of `app/src/app`, silently 404ing every real route with no
  build error. If routes vanish for no clear reason, check for this first.
- **Bash cwd persists across tool calls in this harness** — a `cd` in one
  command carries into the next. `npm run` scripts happen to still work
  from a nested cwd (npm walks up to find the nearest `package.json`), but
  `npx next dev`/`next build` do not — always `cd` to `app/` (or use an
  absolute path) before invoking `next` directly.
- **Don't initialize the DB client at module scope.** `lib/db.ts` builds
  the Turso client lazily inside `getDb()` on purpose: initializing at
  import time throws during `next build` when env vars aren't present. This
  is the same failure Firebase had (`auth/invalid-api-key` during build).
- **Next 16 removed synchronous request APIs.** `cookies()` must be
  awaited, and `params` in route handlers is a Promise. `NextRequest.cookies`
  is still synchronous, which is why `requireRole()` reads the session from
  the request object rather than `next/headers`.
- **A stale agent holding port 5757 no longer kills the new one** —
  `webserver.js` handles `EADDRINUSE` and continues without the local
  status page, since dying there would defeat the whole point of starting
  the dashboard first.
- **Vercel's Hobby (free) plan only allows cron jobs that run once a
  day** — a `vercel.json` `crons` entry scheduled more often doesn't just
  get throttled, it makes the **entire deployment fail**, silently blocking
  every subsequent push until fixed. For anything more frequent, trigger
  the API route from a **GitHub Actions scheduled workflow** instead (see
  `.github/workflows/auto-shutoff.yml`), protected with `CRON_SECRET`.
- **macOS screenshot filenames use a narrow no-break space (U+202F)
  before AM/PM**, not a regular space. Any shell command that types a
  literal space in the filename fails with "No such file or directory" even
  though `ls` displays it identically. Diagnose with
  `python3 -c "import os; print([repr(f) for f in os.listdir('.')])"` then
  use Python's `os.rename`/`os.remove` instead of shell commands.

## Roadmap / not-yet-built ideas

- **Custom domain**: CNAME the Vercel app to
  `holymotherandchildparish.org` once Jason has DNS access there. Blocked
  on DNS access, not a technical blocker.
- ~~Scene/preset remote control ("Prayer Hour" mode)~~ — **dropped**.
- **"Sunset with Mary" — automatic sunrise/sunset broadcast**: a stream
  that starts/stops itself based on the *real* local sunrise/sunset time
  for that day. Possibly a **separate side app** sharing code with wetube.
  - **Camera**: reuse the existing Mass framing as-is — no PTZ automation.
    Jason tested this by hand: zooming in and "Save As"-ing a new `.vmix`
    profile did **not** restore the original framing when reopening the
    Mass profile. PTZ pan/tilt/zoom is a physical motor position, not
    something a vMix project file stores and restores.
  - **Music**: originally planned as a separate `.vmix` profile, but the
    PTZ test above undermines "separate profile = safe" as theory. Needs a
    real test in vMix before relying on either approach.
  - **Timing**: same pattern as auto-shutoff — a GitHub Actions scheduled
    job computing real local sunset (`suncalc` from lat/long, no external
    API).
- **X32 digital mixer remote control** (mute a channel, adjust levels): the
  X32 speaks **OSC over UDP**, not HTTP. Channel addresses look like
  `/ch/01/mix/on` (mute), `/ch/01/mix/fader` (level). Needs the X32 on the
  same network as the church PC and a Node OSC library. This is the "mic
  mute" control from the original brief — never built.
- **Alerts** — proactive email/SMS when the agent heartbeat goes stale, so
  someone finds out the church PC is off *before* Mass. Needs a vendor
  decision. Note this matters more now: with everything else in-house, a
  stale heartbeat is the main signal that something is wrong.
- Any of the above needs new command types, a `commands` schema addition,
  and new buttons in the app. Scope with a `docs/DESIGN-*.md` first — this
  touches live audio/video during real services. Music must be licensed for
  public streaming (e.g. YouTube's Audio Library).
