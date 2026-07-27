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
