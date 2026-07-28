# wetube

**A "big red button" for church livestreaming.** Any authorized volunteer starts and stops the Sunday Mass YouTube livestream from their phone — no software to install, no VPN, nothing to plug in.

<p align="center">
  <img src="docs/screenshots/remote-mobile.png" alt="wetube remote control, running on a phone" width="360" />
</p>

## Why this exists

Before wetube, going live meant someone physically opening YouTube Studio, creating a broadcast, setting the title and visibility, then starting the vMix software on the church PC — every single week, and it only worked if that one specific person was there. wetube collapses all of that into one screen and one button, so any volunteer can do it from a phone.

## How it works

- **Sign in** with Google (admins) or a shared passcode (everyone else) — the sign-in screen doubles as a quick visual guide to using the remote.
- **Check the lights.** Agent and vMix status show up as simple green/red indicators before you even try to go live.
- **Name it and set visibility.** The title auto-fills sensibly (Sunday Mass vs. Daily Mass, with the date) and is editable for weddings, funerals, or anything else. Visibility defaults to Private and slides to Public when it's the real thing.
- **Press the button.** One tap starts the YouTube broadcast and the church-PC video software together; the same button stops it.
- **Watch it happen.** The live YouTube player shows up right in the app once it's live, so whoever's running it can confirm picture and sound without leaving the page.
- **Auto-shutoff failsafe.** Any broadcast still running after 2 hours stops itself automatically, unless an admin explicitly overrides it for a longer event — so nobody can start it and forget it.

## Architecture

Three pieces, kept deliberately simple:

- **`app/`** — Next.js web app (Vercel). The remote control UI, YouTube Data API integration, and Firebase Auth.
- **`agent/`** — a small Node process that runs on the church PC. Polls Firestore for start/stop commands and drives vMix's local API. Ships as a single packaged executable — nothing to install, no Node.js required on the church machine.
- **Firestore** is the relay between the two: the web app and the church-PC agent both only ever make outbound connections to Firestore, so there's no networking, port-forwarding, or VPN setup needed at the church.

```
 volunteer's phone            Firestore              church PC
┌──────────────────┐      ┌──────────────┐      ┌──────────────────┐
│  wetube web app   │ ───▶ │   commands   │ ───▶ │   wetube agent    │
│  (Next.js/Vercel) │ ◀─── │   status     │ ◀─── │  (drives vMix)    │
└──────────────────┘      └──────────────┘      └──────────────────┘
```

## Status

Live and in real use at Holy Mother & Child Parish.

---

*Built for one parish, shared in case it's useful to others running a small livestream on a volunteer crew.*
