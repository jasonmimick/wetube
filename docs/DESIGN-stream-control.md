# DESIGN: Mass Livestream Control (wetube)

## Problem

Streaming a mass to YouTube via vMix (Windows laptop) is currently a fully
manual, ~5-step process done by one person (Jason) in YouTube Studio + vMix
directly. Goal: let any authorized volunteer start/stop the stream from a
phone, with zero VPN/software on their end, while an admin can still curate
details (title, visibility) when needed. Secondary goal: basic
troubleshooting controls (mic mute, levels) without touching the church PC.

## Current manual process (baseline to automate)

1. Go to YouTube Studio
2. Start new live stream (create broadcast)
3. Edit stream — title (today's date), visibility → Public
4. Start vMix streaming
5. Verify it's actually live

Confirmed facts:
- vMix always streams to the **same** persistent YouTube stream key — only
  the YouTube *broadcast* (title/visibility/date) changes week to week.
- YouTube channel is managed via a shared Google account,
  `holymclivestream@gmail.com`, which Jason already uses for Chrome Remote
  Desktop access to the church PC. Same account will be used for the
  YouTube API OAuth grant (separate concern from CRD — no conflict).
- Church PC currently has Chrome Remote Desktop installed; no VPN. Volunteers
  must not need to install anything or connect to a VPN.
- Software CAN be installed on the church PC (it's not locked down).

## v1 UX flow

1. **"Start a New Mass"** button (volunteer or admin).
2. App shows a confirm screen with a pre-filled title (default: `Mass —
   <today's date>`) and visibility (default: Public). User can edit either
   inline.
3. **"Go"** →
   - Creates a new YouTube broadcast with that title/visibility, with
     `enableAutoStart` / `enableAutoStop` set, bound to the existing
     (unchanging) stream key.
   - Sends a start command to vMix.
   - Because of `enableAutoStart`, YouTube flips the broadcast to Live
     automatically the moment vMix's video hits the stream — no separate
     "go live" API call needed.
4. User lands on a **"Current Stream"** view: embedded YouTube player
   (`youtube.com/embed/<videoId>`, trivial once the broadcast is created)
   plus a shareable link, plus a live/offline status indicator.
5. **"Stop"** button → sends stop command to vMix. `enableAutoStop` means
   YouTube auto-completes the broadcast once the feed drops — no separate
   "end broadcast" call needed either.

Admin-only, on top of the above:
- Edit title/visibility/thumbnail after the fact (or before, if prepping
  ahead of time for a holiday Mass, funeral, private event, etc.)
- Mic mute/level controls, scene/camera switching, stream health (dropped
  frames, bitrate)
- Activity log (who started/stopped, when)

## Auth model

Three ways to sign in; which role you land with depends on the path, not
the button you clicked.

- **Google Sign-In (Firebase Auth)** — for Jason and any admins with a
  Google account. Role (`admin`) stored as a Firebase custom claim, granted
  one-time via `scripts/setup/set-admin-claim.mjs` after their first
  sign-in. Full capabilities: curate broadcast title/visibility, mic/level
  controls, generate and rotate the passcode below, view the activity log.
- **Shared passcode → "Mass Controller"** — for volunteers who just need
  start/stop, no Google account required. Admin generates/rotates a
  passcode from the admin screen. A volunteer enters the passcode plus
  their name once; the backend validates the passcode server-side and
  mints a short-lived Firebase custom token carrying a `controller` claim
  (via the Firebase Admin SDK) — a real, if lightweight, authenticated
  session for that use, not a permanent account. Firestore security rules
  gate command writes on that claim, same as the admin path. The
  self-entered name feeds the activity log ("Started by: Jane, via
  passcode").
- **Email-link sign-in** — for people who need their own dedicated,
  non-rotating login but don't have (or don't want to create) a Google
  account tied to their real email — e.g. the pastor, whose parish email is
  Microsoft 365/Outlook, not Google Workspace. "Have an email invite?" on
  the sign-in screen sends a Firebase-hosted magic link (free, no third
  party, no SMS/email vendor needed) to whatever address is entered.
  Clicking it only proves control of that inbox — it grants **no role by
  itself**. The gate is `config/emailAccess`, a Firestore allowlist
  (`{ [lowercased email]: { role, name } }`) managed out-of-band via
  `scripts/setup/grant-email-access.mjs <email> <admin|controller> "<name>"`
  — same spirit as `set-admin-claim.mjs`, but doesn't require a prior
  sign-in first since the Admin SDK can look the email up directly.
  `app/src/app/api/auth/email-link/claim/route.ts` does the actual check +
  `setCustomUserClaims` after the client completes the link sign-in. Not
  self-service — someone has to already be on the allowlist, so this can't
  become an open signup form for arbitrary emails. Verified against the
  Firebase Auth emulator end-to-end (including the not-on-the-allowlist
  case) via `scripts/test-email-link-auth.mjs` — no real email sent during
  that test; the emulator captures sign-in links instead of mailing them.

This keeps the "easy button" promise for occasional volunteers (no account
setup) while admins still get a real identity, a role split, and a usable
activity log — and Firestore's own security rules enforce both roles
without hand-rolled authorization code in Cloud Run.

## Alternate control channel (raised, not yet decided)

Idea: text `/START` or `/STOP` to `holymclivestream@gmail.com` (or a phone
number) as a no-app alternative to the web page.

| Approach | How it works | Tradeoff |
|---|---|---|
| **SMS via Twilio (recommended if texting is wanted)** | Volunteer texts a dedicated number; Twilio webhook hits the same backend endpoint the web button calls; Twilio can auto-reply "Stream started." | Cheap (~$1/mo + fractions of a cent/msg), reliable, low latency, simple webhook — no OAuth. Needs a small allowlist of authorized phone numbers. |
| **Email command parsing (`/START` in subject to the Gmail account)** | Poll or Gmail-push-notify on new mail to `holymclivestream@gmail.com`, parse subject/body. | No new service to pay for, but carrier SMS→email gateways are inconsistent/deprecated, latency can be minutes not seconds, needs Gmail API + Pub/Sub push setup, and needs its own sender allowlist. Weakest option. |
| **Skip for v1** | Web app only. | Simplest to ship; texting becomes a fast-follow once the core flow is proven. |

Recommendation: **build the web app first**; if texting is still wanted
after that, do it via Twilio, not email parsing — much less infrastructure
for a more reliable result.

## Core automation architecture (locked in regardless of hosting choice)

```
"Go" tap
  → backend calls YouTube Data API v3:
       liveBroadcasts.insert (title, visibility, autoStart/autoStop=true)
       liveBroadcasts.bind   (bind to the existing persistent stream key)
  → backend sends "start" to a small agent process on the church PC
  → agent calls vMix's local HTTP API (http://127.0.0.1:8088/api/?Function=StartStreaming)
  → YouTube auto-transitions to Live once it sees vMix's video
  → frontend polls broadcast status + vMix status until confirmed live

"Stop" tap
  → backend sends "stop" to the agent → vMix StopStreaming
  → YouTube auto-completes the broadcast
```

One-time setup needed regardless of hosting choice:
- Google Cloud project, YouTube Data API v3 enabled, OAuth client.
- One-time OAuth consent as `holymclivestream@gmail.com`, **consent screen
  must be set to "In production"** (not "Testing") — testing-mode refresh
  tokens silently expire after 7 days, which would break the automation
  weekly. Production mode with an unverified app just means clicking through
  a one-time "unverified app" warning during setup — fine for a single
  account you control.
- A small agent process installed on the church PC that can (a) reach
  vMix's local HTTP API and (b) receive commands from wherever the app is
  hosted.

## Reliability & fallback (applies to every hosting option, not just one)

Every option in this doc shares the same underlying dependency: something
running on the church PC has to be alive and reachable for remote control
to work at all. That's not specific to the Firestore-mailbox approach —
it's inherent to controlling on-prem hardware remotely, regardless of
transport. Given the stakes (Sunday morning, live), this needs an explicit
plan rather than hoping it just works:

**Reduce the odds of a miss:**
- Run the agent as a real Windows Service (not a manually-launched script)
  with Windows' built-in recovery settings — auto-restart on crash,
  auto-start on boot. Covers "agent crashed" and "PC rebooted overnight."

**Make failures visible instead of silent:**
- Agent writes a heartbeat (e.g. every 30s) to the mailbox. The web app
  surfaces an "Agent offline" banner **before** anyone taps Start if the
  last heartbeat is stale — caught ahead of time, not mid-tap.
- Every command carries a timeout (~15-20s). No corresponding status
  update in that window → UI shows an explicit "No response from church
  PC" state, not an infinite spinner.
- Optional hardening: alert an admin (email/SMS) if the heartbeat goes
  stale outside expected hours, so it's caught before the next mass
  instead of during it.

**Ultimate fallback:**
- The current manual process (Chrome Remote Desktop → YouTube Studio +
  vMix by hand) isn't going away. If the automation is fully down, the
  worst case is exactly today's status quo, not a new failure mode.

**Precondition — resolved:** today, Jason manually preps the PC (wakes it,
logs in, opens vMix) before each mass. Decision: remove that dependency
entirely rather than shift it to another person, via a one-time PC setup:
- Disable sleep in Windows Power Options (stays awake, plugged in)
- Enable auto-login (comes back up logged-in after any restart)
- Auto-launch vMix at Windows startup (Startup folder or Task Scheduler)
- Disable, or reschedule to a safe weekday time, Windows Update's automatic
  restarts, so it doesn't reboot itself right before a mass

With this in place nobody needs to physically touch the PC in the normal
case — the agent heartbeat check (above) catches the rare case where it's
still down for some other reason.

## Hosting/relay options (open — for your review)

The one hard constraint: something on the public internet needs a way to
reach vMix's API, which only listens on `localhost` on a PC with no public
IP. Every option below solves that differently.

### Option 1 — Vercel (app) + Cloudflare Tunnel (relay) + local agent
```
Phone → Next.js app (Vercel, Clerk auth) → Cloudflare named tunnel → cloudflared + agent on church PC → vMix
```
- Matches your usual stack (Vercel + Clerk) for the app itself.
- **Needs a domain** on Cloudflare's free DNS plan — the free anonymous
  `trycloudflare.com` tunnels aren't meant to stay up long-term (URL churns
  on restart).
- Very mature/reliable once set up; Cloudflare handles the tunnel
  infrastructure for you.

### Option 2 — Vercel (app) + Tailscale Funnel (relay) + local agent
```
Phone → Next.js app (Vercel, Clerk auth) → Tailscale Funnel HTTPS URL → agent on church PC → vMix
```
- Same shape as Option 1, but Tailscale's free tier gives you a working
  `*.ts.net` HTTPS hostname immediately — **no domain purchase needed**.
- Slightly less battle-tested for "leave it running forever" than Cloudflare
  Tunnel, but plenty solid at this traffic scale, and free.
- Good default if you want to move fast without buying/configuring a domain.

### Option 3 — Fully self-hosted on the church PC
```
Phone → single Node/Next app running ON the church PC → vMix (localhost, no hop)
        exposed to the internet via Cloudflare Tunnel or Tailscale Funnel
```
- Collapses the whole thing into one process — no separate cloud app +
  agent split, no protocol between them.
- The app's uptime is tied to the church PC, but that's moot: if the PC is
  off, there's no vMix to control anyway.
- Simplest architecture to reason about; deploys are "restart the service
  on the PC" (e.g. via a Windows service + `git pull`) rather than Vercel's
  push-to-deploy — a real convenience you'd be giving up.
- No Vercel account/billing surface at all.

### Option 4 — Fly.io app + outbound-only relay agent (no tunnel, no domain)
```
Phone → app on Fly.io (own *.fly.dev URL) → tiny relay on the same Fly app
       ← agent on church PC opens an outbound WebSocket to the relay (never
         accepts inbound connections) → vMix
```
- No domain, no tunnel software to install on the church PC — the agent
  only ever makes outbound connections, so it tends to survive router
  reboots/flaky church WiFi more gracefully (just reconnects).
- Trade custom relay + reconnect logic (you're writing/maintaining it) for
  not depending on Cloudflare/Tailscale infra.

### Option 5 — GCP (Cloud Run) app + Firestore as the relay "mailbox" (no tunnel, no domain, no custom tunnel software)
```
Phone → Next.js app on Cloud Run (own *.run.app HTTPS URL, Firebase Auth: Google Sign-In + passcode)
             │
             ▼ writes a "command" doc (start/stop, who, when)
         Firestore
             ▲
             │ agent polls every ~3-5s for new commands
Church PC → small agent process → vMix local HTTP API
             │
             ▼ writes a "status" doc back (live/offline, error, etc.)
         Firestore  →  app reads/listens for status → updates UI
```
- **You raised building your own tunnel app** — I'd steer away from that:
  real tunneling means solving NAT traversal, TLS, reconnect logic, and
  exposed-port security yourself, which is exactly the hard part Cloudflare
  Tunnel/Tailscale already solved. A simpler shape gets you the same
  outcome: neither side needs an open port at all if they both just talk
  *outbound* to a shared mailbox. Firestore (Google's managed NoSQL DB)
  works well as that mailbox — the Cloud Run app writes commands to it, the
  agent on the church PC polls it (or uses a realtime listener, handled by
  Google's SDK, not something you build) and writes status back. This
  **is** "your own app," in that you write the small agent + the Cloud Run
  API routes — you're just not building the transport layer underneath it.
- No domain, no Cloudflare/Tailscale account, no tunnel software on the
  church PC at all — just the agent process itself with a scoped-down
  Google service account key (read/write access to one Firestore
  collection, nothing else).
- Cloud Run hands you a working public HTTPS URL immediately for the app.
- Worth considering given the nonprofit angle below, and if you'd rather
  consolidate on one cloud provider.

**GCP cost breakdown at this traffic scale (a few masses/week):**

| Component | Service | Free tier | Expected cost |
|---|---|---|---|
| Web app + API routes | Cloud Run | 2M requests/mo, 360k GB-sec + 180k vCPU-sec/mo, always free | $0 |
| Command/status mailbox | Firestore (Native mode) | 50k reads + 20k writes + 20k deletes/day, always free | $0 (a mass uses maybe a few hundred reads/writes, total) |
| Container builds/deploys | Cloud Build + Artifact Registry | Free tier covers small, infrequent builds | $0 |
| Auth | Firebase Authentication | Free (Google Sign-In + custom token minting) | $0 |
| YouTube control | YouTube Data API v3 | Free, quota-based (no billing at all) | $0 |
| Domain | — not needed — | Cloud Run's `*.run.app` URL is enough | $0 |
| Church PC agent | runs on existing hardware | just needs Node.js installed | $0 |

Realistic total: **$0/month** at launch. One caveat: GCP generally wants a
billing account/card on file before you can enable most APIs, even ones
that stay entirely within free-tier limits — you won't be charged unless
you exceed them, but set a budget alert (a few dollars) as a tripwire so
you'd know immediately if something misconfigured ever generated real cost.

**Does Cloudflare Workers fit in here?** Workers is Cloudflare's serverless
compute product (comparable to Cloud Run or Vercel Functions) — it's a
different thing from Cloudflare *Tunnel*, which is what actually solves
reaching a machine behind a home/church router. Workers alone has the exact
same limitation Vercel and Cloud Run have on their own: it can't reach
vMix's `localhost` API without something doing the tunnel/relay job too.
If you're going all-in on GCP, there's no real reason to add Cloudflare
Workers into the mix — it'd be a second vendor solving a problem Cloud Run
already solves for free.

**Nonprofit angle (Google for Nonprofits / GCP):**
- Churches generally **do** qualify for Google for Nonprofits in the US —
  a church with an IRS group exemption typically qualifies automatically.
  The only categories Google excludes outright are government entities,
  schools, and healthcare orgs. (The one religious-specific restriction is
  on **Google Ad Grants** — those can't fund ads promoting religious
  content/belief — which is irrelevant here since this project doesn't
  touch ads.)
- Google for Nonprofits does list a Google Cloud credits benefit, but I
  couldn't pin down a guaranteed dollar figure from Google's own docs/
  community threads (numbers floated informally, nothing authoritative) —
  worth applying and checking the exact offer directly at
  [Google for Nonprofits](https://www.google.com/nonprofits/) once you
  decide to pursue this angle.
- Independent of nonprofit approval (which takes a verification step and
  some lead time): GCP's standing **Always Free** tier — e.g. Cloud Run's
  free monthly request/CPU allowance, a free e2-micro VM in some regions —
  is available to any account, nonprofit or not, and is very likely enough
  on its own for this app's actual traffic (a handful of button-presses per
  week). You don't need nonprofit approval to start building on Option 5.

**Current lean, given GCP is in play and you want a free/hobby-tier launch
path:** Option 5 (Cloud Run + Firestore mailbox) — no domain, no
Cloudflare/Tailscale account, no tunnel software, realistic $0/month, and
it sidesteps building actual tunnel/NAT-traversal code by using Firestore
as the outbound-only meeting point instead. Options 2 and 3 remain solid
fallbacks if you'd rather not add Firestore into the mix.

## Open questions

- Confirm: build Option 5 (Cloud Run + Firestore mailbox) for the POC?
- Apply for Google for Nonprofits before or after the POC build — or skip
  it for now since the Always Free tier already covers this app's traffic?
- How many mic/audio channels does vMix need to expose, and what should
  they be labeled as (e.g. "Altar," "Lectern," "Cantor")?
- Any troubleshooting beyond mic mute/level — camera/scene switching?
- Texting: worth building in v1, or defer per the recommendation above?

## Recommendation summary

- Automation logic (YouTube auto-start/stop + vMix agent) is settled
  regardless of hosting — build that core first.
- Ship the web app only for v1; add Twilio-based texting later if still
  wanted, skip email-command parsing (least reliable of the options).
- Hosting: Option 5 (Cloud Run + Firestore mailbox) is the current lead —
  free, no domain, no third-party tunnel vendor, no custom tunnel code.
- Auth: Firebase Authentication — Google Sign-In for admins, a
  rotatable shared passcode (minted into a scoped custom token) for
  ad hoc "Mass Controller" volunteers. One vendor, integrates directly
  with Firestore security rules.
