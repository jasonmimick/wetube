# Manual Setup

Everything here needs a human with real credentials — none of it can be
scripted from inside a coding sandbox. Follow in order; each phase notes
which helper script (if any) does the mechanical part.

Background/design context: [docs/DESIGN-stream-control.md](DESIGN-stream-control.md).
The local POC (agent + mock vMix + Firestore emulator relay loop, and the
Firestore security-rules tests) already passes without any of this — see
`npm test` at the repo root. This doc is what turns the POC into the real
thing.

## Phase 0 — a note on accounts

Three Google accounts are in play, doing different jobs — don't conflate them:

- **`jmimick@gmail.com`** (you) — will own/administer the GCP project and
  be the first Firebase Auth "admin" in the app.
- **`holymclivestream@gmail.com`** — owns the church's YouTube channel.
  Used *only* for the one-time YouTube OAuth consent in Phase 4. Also
  happens to be what you use for Chrome Remote Desktop to the church PC —
  unrelated, no conflict.
- Whatever Google account currently has `gcloud` authenticated on your
  machine (check with `gcloud auth list`) — may be neither of the above.

## Phase 1 — GCP project

1. Create the project (or reuse one if you already made one poking around):
   ```
   gcloud projects create wetube-livestream --name="Holy Mass Livestream"
   gcloud config set project wetube-livestream
   ```
2. Link your personal account as Owner (the ask from earlier in this build):
   ```
   gcloud projects add-iam-policy-binding wetube-livestream \
     --member="user:jmimick@gmail.com" --role="roles/owner"
   ```
   Or do this by hand: GCP Console → IAM & Admin → Grant Access → add
   `jmimick@gmail.com` → role `Owner`.
3. Enable the APIs this project needs:
   ```
   gcloud services enable \
     firestore.googleapis.com \
     run.googleapis.com \
     cloudbuild.googleapis.com \
     artifactregistry.googleapis.com \
     youtube.googleapis.com \
     iam.googleapis.com
   ```
4. Set a budget alert as a tripwire (Console → Billing → Budgets & alerts
   → create budget, e.g. $5/month with an email alert). Expected real cost
   is $0/month at this traffic — see the cost table in the design doc —
   this just catches anything misconfigured.

## Phase 2 — Firebase (Firestore + Auth)

1. Go to [console.firebase.google.com](https://console.firebase.google.com) →
   "Add project" → select the **existing** `wetube-livestream` GCP project
   (don't create a new one — Firebase attaches to it).
2. Firestore: Build → Firestore Database → Create database → **Native
   mode** → pick a region (e.g. `us-central1` — same region as Cloud Run
   in Phase 6, to minimize latency).
3. Auth: Build → Authentication → Sign-in method → enable **Google**, and
   **Email/Password → Email link (passwordless sign-in)** for the
   dedicated-login path (see design doc "Auth model" — used for the
   pastor, whose email isn't Google). Under Authentication → Settings →
   Authorized domains, make sure the production domain
   (`wetube-mu.vercel.app`, or the custom domain if that's live) is listed
   — Firebase only trusts `localhost` and `*.firebaseapp.com` by default,
   and email-link sign-in will fail on any origin not in that list.
4. Deploy the security rules from this repo (governs what the browser
   client can read — see `firestore.rules`):
   ```
   npx firebase-tools deploy --only firestore:rules --project wetube-livestream
   ```
5. Register a web app: Project settings → General → Your apps → Add app →
   Web. Copy the `apiKey`, `authDomain`, `projectId` it gives you — these
   become the `NEXT_PUBLIC_FIREBASE_*` values in Phase 6.

## Phase 3 — service account for the church-PC agent

The agent needs least-privilege Firestore access (nothing else):

```
gcloud iam service-accounts create wetube-agent --display-name="wetube agent"

gcloud projects add-iam-policy-binding wetube-livestream \
  --member="serviceAccount:wetube-agent@wetube-livestream.iam.gserviceaccount.com" \
  --role="roles/datastore.user"

gcloud iam service-accounts keys create wetube-agent-key.json \
  --iam-account=wetube-agent@wetube-livestream.iam.gserviceaccount.com
```

Keep `wetube-agent-key.json` — it goes on the church PC in Phase 7. Treat
it like a password (it's gitignored here already; never commit it).

## Phase 4 — YouTube OAuth (the fiddly one)

This authorizes the app to create/bind broadcasts on the church's channel,
without ever handling `holymclivestream@gmail.com`'s actual password.

1. GCP Console → APIs & Services → OAuth consent screen:
   - User type: **External**
   - Add scope `https://www.googleapis.com/auth/youtube`
   - **Publishing status: switch to "In production"**, not "Testing" —
     testing-mode refresh tokens silently expire after 7 days, which would
     break the automation weekly. Going to production with an unverified
     app just means a one-time "unverified app" click-through during
     consent below — expected and fine for a single account you control.
2. APIs & Services → Credentials → Create Credentials → OAuth client ID →
   type **Desktop app** (simplest for the one-time script-based consent
   flow below — no hosted redirect URI needed). Note the client ID/secret.
3. Get a refresh token — run this locally, and when the browser opens,
   **sign in as `holymclivestream@gmail.com`**, not your own account:
   ```
   GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=... \
     node scripts/setup/get-youtube-refresh-token.mjs
   ```
   It prints a `GOOGLE_OAUTH_REFRESH_TOKEN` value — save it.
4. Find which persistent stream vMix is already configured to push to
   (per the design doc, this key never changes week-to-week):
   ```
   GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=... \
     GOOGLE_OAUTH_REFRESH_TOKEN=... node scripts/setup/list-youtube-streams.mjs
   ```
   Match the title against what's in vMix's stream settings, and note its
   `id` as `YOUTUBE_STREAM_ID`.

## Phase 5 — try it for real before touching the church setup

Before wiring any of this to the actual church PC/YouTube channel, dry-run
the whole pipeline on your own Mac against **your own personal YouTube
channel**, using OBS instead of vMix (vMix is Windows-only, OBS is native
on macOS and ships the same kind of local control API — see the design
doc's "Auth model"/streamer-adapter notes):

1. Install [OBS Studio](https://obsproject.com) → Tools → WebSocket Server
   Settings → enable it, note the port/password (defaults: `4455`, no
   password unless you set one).
2. In OBS, add your own YouTube account as a streaming destination (Settings
   → Stream → YouTube, sign in, pick/create a persistent stream key —
   same "reusable key" pattern as the church setup).
3. Run the agent pointed at OBS instead of the mock:
   ```
   cd agent
   STREAMER=obs OBS_WS_URL=ws://127.0.0.1:4455 OBS_WS_PASSWORD=<if set> \
     FIRESTORE_EMULATOR_HOST=127.0.0.1:8090 FIREBASE_PROJECT_ID=demo-wetube \
     node agent.js
   ```
   (Run `npm test` from the repo root in another terminal first if you want
   the Firestore emulator up — or point at your real Firebase project
   instead by swapping in `GOOGLE_APPLICATION_CREDENTIALS`.)
4. Write a start command (however you like — the app once deployed, or
   directly via a Firestore console/script) and confirm OBS actually starts
   streaming and your personal YouTube broadcast goes live on its own
   (`enableAutoStart`). This is the real, load-bearing thing to verify — if
   it works here, it'll work with vMix + the church's channel, since the
   only thing that changes is which adapter (`obs` vs `vmix`) is selected.

## Phase 6 — deploy the app to Cloud Run

```
cd app
gcloud run deploy wetube \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-build-env-vars NEXT_PUBLIC_FIREBASE_API_KEY=...,NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...,NEXT_PUBLIC_FIREBASE_PROJECT_ID=wetube-livestream \
  --set-env-vars FIREBASE_PROJECT_ID=wetube-livestream,GOOGLE_OAUTH_CLIENT_ID=...,GOOGLE_OAUTH_CLIENT_SECRET=...,GOOGLE_OAUTH_REFRESH_TOKEN=...,YOUTUBE_STREAM_ID=...
```

`--allow-unauthenticated` is intentional and safe here — real access control
is Firebase Auth + Firestore rules (see design doc), not Cloud Run's own
IAM layer. Later hardening: move the OAuth client secret and refresh token
into Secret Manager (`--set-secrets` instead of `--set-env-vars`) rather
than plain env vars — fine to defer for the POC.

## Phase 7 — bootstrap the first admin

1. Open the deployed Cloud Run URL, click "Sign in with Google", sign in as
   `jmimick@gmail.com`. You'll land on "no role is assigned yet" — expected.
2. Grant yourself admin (needs the same service account key from Phase 3,
   or any credential with Firebase Auth admin access):
   ```
   FIREBASE_PROJECT_ID=wetube-livestream \
     GOOGLE_APPLICATION_CREDENTIALS=wetube-agent-key.json \
     node scripts/setup/set-admin-claim.mjs jmimick@gmail.com
   ```
3. Sign out and back in on the app — you should now see the Admin panel.
4. Click "Generate new Mass Controller passcode" and hand it out to
   volunteers.
5. For anyone who needs a dedicated non-rotating login instead (e.g. the
   pastor — see design doc "Auth model"), grant their email access first —
   no prior sign-in needed for this one:
   ```
   FIREBASE_PROJECT_ID=wetube-livestream \
     GOOGLE_APPLICATION_CREDENTIALS=wetube-agent-key.json \
     node scripts/setup/grant-email-access.mjs their@email.com controller "Their Name"
   ```
   Test with your own alias first, not their real address — click "Sign in
   by email instead" on the sign-in screen, confirm the emailed link
   actually signs you in with the right role, *then* grant the real
   person's email.

   Two gotchas hit during the first real test (2026-07-28):
   - **`auth/operation-not-allowed`** — Authentication → Sign-in method →
     Email/Password has two separate toggles; enabling "Email/Password"
     alone isn't enough, "Email link (passwordless sign-in)" underneath it
     also has to be on, and actually saved.
   - **The email lands in spam** — Firebase's default sender
     (`noreply@<project>.firebaseapp.com`) has no sending reputation of its
     own. First-time recipients (this very much includes the pastor) should
     be told in advance to check spam/junk, at least until Firebase sends
     enough mail to that address to stop being filtered.

## Phase 8 — church PC agent (one-stop install, no Node.js needed)

The agent ships as a single Windows executable (built via `npm run
build:win` in `agent/`, using `@yao-pkg/pkg` — see `agent/package.json`).
No Node.js install, no `npm install`, no terminal on the church PC. The
exact same source also builds to a macOS binary (`npm run build:mac`),
which is how this was verified locally before ever touching Windows: built,
ran standalone from a clean directory with just a `.env` file next to it,
confirmed real Firestore heartbeats and the manual start/stop endpoints
both worked — the Windows build is the same code, just a different target.

1. On this Mac: `cd agent && npm run build:win` → produces
   `agent/dist/wetube-agent-win.exe`.
2. Copy two files to the church PC (via Chrome Remote Desktop, a USB
   drive, whatever's easiest) into a new folder, e.g. `C:\wetube-agent\`:
   - `wetube-agent-win.exe`
   - `wetube-agent-key.json` (the service account key from Phase 3)
3. In that same folder, create a plain text file named `.env`:
   ```
   STREAMER=vmix
   VMIX_BASE_URL=http://127.0.0.1:8088
   FIREBASE_PROJECT_ID=wetube-livestream
   GOOGLE_APPLICATION_CREDENTIALS=C:\wetube-agent\wetube-agent-key.json
   POLL_INTERVAL_MS=3000
   ```
4. Double-click `wetube-agent-win.exe` to run it. A console window stays
   open (that's normal — it's the log). Open **http://127.0.0.1:5757** in
   a browser on that PC to see the local status/control page: vMix
   connected, currently streaming, last heartbeat, and manual Start/Stop
   buttons for troubleshooting directly on the machine (bypasses the cloud
   app entirely — this is the "GUI" for whoever's physically there).
5. Make it start automatically: right-click `wetube-agent-win.exe` → Create
   shortcut, then move that shortcut into the Startup folder
   (`Win+R` → `shell:startup`). Combined with the PC hardening below, this
   means it's running again within seconds of any reboot without anyone
   touching the machine. (A true Windows Service with crash auto-restart —
   e.g. via [NSSM](https://nssm.cc/) — is a further hardening option later,
   but isn't necessary to get started.)
6. PC hardening (removes the "someone has to prep it" dependency — see
   design doc "Reliability & fallback"):
   - Settings → System → Power → turn off sleep (plugged in)
   - Enable auto-login (`netplwiz` → uncheck "users must enter a password")
   - Put a shortcut to vMix in `shell:startup` too, so it auto-launches
   - Settings → Windows Update → Advanced options → pause updates around
     mass times, or schedule restarts for a safe weekday window

That's it — at that point volunteers can go to the Cloud Run URL, enter the
passcode, and use "Start a New Mass" for real.
