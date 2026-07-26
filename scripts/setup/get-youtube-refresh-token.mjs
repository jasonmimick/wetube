// One-time OAuth authorization: run this locally, log in AS
// holymclivestream@gmail.com when the browser opens, and it prints a
// refresh token to put in Cloud Run's GOOGLE_OAUTH_REFRESH_TOKEN env var.
// See docs/MANUAL_SETUP.md for the OAuth client + consent screen setup
// this depends on (must be an OAuth client of type "Desktop app", and the
// consent screen must be in "In production" publishing status — otherwise
// this refresh token silently expires after 7 days).
//
// Usage:
//   GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=... \
//     node scripts/setup/get-youtube-refresh-token.mjs

import { google } from "googleapis";
import http from "node:http";

const REDIRECT_URI = "http://localhost:53682/oauth2callback";
const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error("Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET first.");
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline", // required to get a refresh token
  prompt: "consent", // forces a refresh token even on repeat runs
  scope: ["https://www.googleapis.com/auth/youtube"],
});

console.log("\nOpen this URL and sign in as holymclivestream@gmail.com:\n");
console.log(authUrl);
console.log("\nWaiting for the redirect back to", REDIRECT_URI, "...\n");

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  if (url.pathname !== "/oauth2callback") {
    res.writeHead(404).end();
    return;
  }

  const code = url.searchParams.get("code");
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Done — you can close this tab and return to the terminal.");
  server.close();

  const { tokens } = await oauth2Client.getToken(code);
  if (!tokens.refresh_token) {
    console.error(
      "\nNo refresh_token came back. This usually means you've already " +
        "authorized this app before — revoke access at " +
        "https://myaccount.google.com/permissions and run this again."
    );
    process.exit(1);
  }

  console.log("\nGOOGLE_OAUTH_REFRESH_TOKEN=" + tokens.refresh_token);
  console.log("\nSave that in Cloud Run's environment variables (see docs/MANUAL_SETUP.md).");
  process.exit(0);
});

server.listen(53682);
