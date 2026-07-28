# wetube

Automates starting/stopping the YouTube livestream of church masses, which
run through vMix on a Windows laptop at the church. A web app lets any
authorized volunteer start/stop the stream from a phone (no VPN, no
software install on their end), while an admin can still curate the
YouTube broadcast title/visibility. Also covers basic vMix troubleshooting
controls (mic mute).

## Docs

- [docs/DESIGN-stream-control.md](docs/DESIGN-stream-control.md) — full
  architecture, UX flow, auth model, reliability plan, hosting options
  considered (settled on GCP: Cloud Run + Firestore).
- [docs/MANUAL_SETUP.md](docs/MANUAL_SETUP.md) — the manual, credentialed
  steps a human has to do (GCP/Firebase project, YouTube OAuth, Cloud Run
  deploy, church-PC agent install) that can't be scripted from a sandbox.

## Layout

Three separate deployables, each with its own `package.json`/`node_modules`,
plus root-level dev/test tooling:

- `app/` — Next.js (App Router, TS) control panel. Deploys to **Vercel**
  (GitHub integration — `git push origin master` triggers a production
  build automatically; never run `vercel --prod` manually). Firestore/Auth
  backend still lives on GCP/Firebase; only the web app itself moved off
  Cloud Run to Vercel after early friction with Cloud Run deploys.
- `agent/` — plain Node.js process that runs **on the church PC**. Polls
  Firestore for start/stop commands and drives vMix's local HTTP API (or
  OBS/mock, via a pluggable adapter — see `agent/streamers/`). Serves a
  local-only status/control page (`agent/webserver.js` + `status.html`,
  127.0.0.1:5757). Ships to the church PC as a single executable built with
  `@yao-pkg/pkg` (`npm run build:win` / `build:mac`), not a Node.js install.
- `scripts/` — dev/test tooling only (not deployed): the local test suite
  (`npm test` from repo root) and one-off setup helpers in
  `scripts/setup/` (YouTube OAuth, admin bootstrap — see MANUAL_SETUP.md).
- `firestore.rules` / `firebase.json` at the repo root — the Firebase
  project boundary spans both `app/` and the agent, so these live above
  both rather than inside `app/`.

## Commands

```
npm test                 # from repo root: spins up the Firestore emulator,
                          # runs the agent<->Firestore<->mock-vMix relay
                          # loop test + the Firestore security-rules test
cd app && npm run build   # type-check + build the Next.js app
cd app && npm run dev     # local dev server
cd agent && npm start      # run the agent (see agent/.env.example for config)
cd agent && npm run build:win   # build the church-PC executable (dist/wetube-agent-win.exe)
cd agent && npm run build:mac   # build a macOS executable for local testing of the same code
```

Running the Firestore emulator requires a JRE on PATH — if `java -version`
fails but Homebrew has `openjdk` installed, prepend it:
`export PATH="/opt/homebrew/opt/openjdk/bin:$PATH"`.

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
  misleading. If real heartbeat history ever gets stored, that's the place
  to reintroduce it.
- Design was iterated as a shareable Claude Artifact mockup first, then
  ported into the real app once approved — see git log around "Redesign
  control UI" for the before/after.

## Gotchas hit during the POC build

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
- **Firebase Auth client SDK breaks SSR/prerendering** if
  `NEXT_PUBLIC_FIREBASE_*` isn't set at build time (throws
  `auth/invalid-api-key` during `next build`, or 500s during SSR even with
  `dynamic = "force-dynamic"`). Fix: since this page is inherently
  browser-only anyway (Firebase Auth state, live Firestore listeners),
  render it via `next/dynamic(() => import("./HomeClient"), { ssr: false })`
  from a thin Client Component wrapper (`ssr: false` isn't allowed directly
  in a Server Component) — see `app/src/app/page.tsx` /
  `ClientOnlyHome.tsx`.
- **Port 8080 may already be taken** (e.g. by the `slab` local PaaS) —
  the Firestore emulator is configured to use **8090** instead
  (`firebase.json`, `firebaseClient.ts`, and the test scripts all agree on
  this; keep them in sync if it ever changes).
- **`firebase-tools` prompts interactively on first run** (usage-collection
  opt-in) unless `CI=true` is set — the test scripts assume this; set it
  if running the emulator manually too.

## Roadmap / not-yet-built ideas

Discussed 2026-07-27, deliberately deferred — not started, just captured
so the context isn't lost:

- **Custom domain**: CNAME the Vercel app to
  `holymotherandchildparish.org` once Jason has DNS access there. Blocked
  on him getting DNS access, not a technical blocker.
- ~~Scene/preset remote control ("Prayer Hour" mode)~~ — **dropped**,
  not pursuing this one. (Was: camera on a Marian statue + meditative
  music, started from the remote. Superseded by the sunrise/sunset idea
  below, which is more interesting to Jason.)
- **"Sunset with Mary" — automatic sunrise/sunset broadcast**: a stream
  that starts/stops itself automatically based on the *real* local
  sunrise/sunset time for that day (not a fixed clock time). Jason is
  thinking about this as a possible **separate side app** that shares
  some code/blocks with wetube rather than a feature bolted onto it —
  not scoped as a design doc yet, but the shape got clarified in
  conversation on 2026-07-27, deliberately kept small:
  - **Camera**: reuse the existing Mass framing as-is — no PTZ
    automation, no camera preset recall. This was explicitly decided
    after Jason tested PTZ preset switching by hand: zooming in and
    "Save As"-ing a new `.vmix` profile did **not** restore the
    original framing when reopening the Mass profile — PTZ pan/tilt/
    zoom is a physical position of the camera motor, not something a
    vMix project file stores and restores on open. Confirms the
    earlier note that PTZ preset recall needs real verification before
    relying on it for anything; for now, just don't move the camera.
  - **Music**: build it in its own **separate `.vmix` profile**
    dedicated to this feature, specifically so there's zero chance of
    it ever bleeding into Mass's audio bus — Jason was (rightly)
    nervous about adding a music Input to the shared Mass profile.
  - **Timing**: same automation pattern as the 2-hour auto-shutoff — a
    scheduled job (GitHub Actions, not Vercel Cron — see the Hobby-plan
    cron-frequency gotcha below) computes the real local sunset time
    (a small library like `suncalc`, from lat/long + date, no external
    API needed) and triggers the existing start/stop broadcast logic
    automatically.
- **X32 digital mixer remote control** (mute a channel — e.g. "mute
  guitar mic" — and adjust levels, from the wetube app): the X32 speaks
  **OSC over UDP**, not HTTP — a different protocol from vMix's API.
  Channel addresses look like `/ch/01/mix/on` (mute toggle),
  `/ch/01/mix/fader` (level). Needs the X32 reachable on the same network
  as the church PC agent (should be, same building) and a Node OSC
  library. This was the "mic mute" troubleshooting control mentioned in
  the original project brief at the top of this file — never built.
- **Alerts** — Jason flagged wanting this next (2026-07-27), no scope
  given yet beyond the word itself. Likely candidate given everything
  else in this file: proactive email/SMS notification when the agent
  heartbeat goes stale (church PC off/unreachable), so someone finds out
  before Mass starts rather than after. Needs a vendor decision (email
  or SMS provider) before building — don't assume one.
- Any of the above would need: new agent command types beyond just
  start/stop, a corresponding Firestore command schema, and new buttons
  in the app. Nothing here has been scoped as an actual design doc yet —
  do that (`docs/DESIGN-*.md`) before building, given it touches live
  audio/video during real services. Music used for any of these needs to
  be actually licensed for public streaming (e.g. YouTube's Audio
  Library) — random copyrighted audio on a live public stream risks a
  Content ID claim or takedown on the channel.

## More gotchas (post-launch)

- **Vercel's Hobby (free) plan only allows cron jobs that run once a
  day** — a `vercel.json` `crons` entry scheduled more often than that
  doesn't just get throttled, it makes the **entire deployment fail**,
  silently blocking every subsequent push until fixed (this happened for
  real: the auto-shutoff feature's every-10-minutes cron broke every
  deploy until removed). For anything that needs to run more often than
  daily without upgrading the plan, trigger the same API route from a
  **GitHub Actions scheduled workflow** instead (see
  `.github/workflows/auto-shutoff.yml`) — free, no plan change, and it
  can run as often as you want. Protect the route itself with a shared
  secret (`CRON_SECRET`) checked as a bearer token, set as both a Vercel
  env var and a GitHub Actions repo secret (`gh secret set`).
- **macOS screenshot filenames use a narrow no-break space (U+202F)
  before AM/PM**, not a regular space — e.g. `Screenshot ... 9.00.40
  PM.png` looks like it has a normal space but doesn't. Any shell
  command that types a literal space in the filename (`cp`, `mv`, `rm`,
  even with proper quoting) fails with "No such file or directory" even
  though `ls` displays it identically. Diagnose with
  `python3 -c "import os; print([repr(f) for f in os.listdir('.')])"` to
  see the real bytes, then use Python's `os.rename`/`os.remove` (or just
  drag-and-drop in Finder) instead of shell commands for these files.
