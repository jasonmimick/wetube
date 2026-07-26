// Lists the YouTube "liveStream" resources (persistent stream keys) on the
// authorized channel, so you can find the one vMix is already configured
// to push to and use its id as YOUTUBE_STREAM_ID. Run this after getting a
// refresh token from get-youtube-refresh-token.mjs.
//
// Usage:
//   GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=... \
//     GOOGLE_OAUTH_REFRESH_TOKEN=... node scripts/setup/list-youtube-streams.mjs

import { google } from "googleapis";

const { GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN } = process.env;
if (!GOOGLE_OAUTH_CLIENT_ID || !GOOGLE_OAUTH_CLIENT_SECRET || !GOOGLE_OAUTH_REFRESH_TOKEN) {
  console.error(
    "Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, and GOOGLE_OAUTH_REFRESH_TOKEN first."
  );
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET);
oauth2Client.setCredentials({ refresh_token: GOOGLE_OAUTH_REFRESH_TOKEN });

const youtube = google.youtube({ version: "v3", auth: oauth2Client });
const res = await youtube.liveStreams.list({ part: ["id", "snippet", "cdn"], mine: true });

const streams = res.data.items || [];
if (!streams.length) {
  console.log("No liveStreams found on this channel yet — create one in YouTube Studio first.");
} else {
  console.log(`Found ${streams.length} stream(s):\n`);
  for (const s of streams) {
    console.log(`  id:          ${s.id}`);
    console.log(`  title:       ${s.snippet.title}`);
    console.log(`  ingestion:   ${s.cdn.ingestionInfo?.streamName ? "(stream key hidden)" : "n/a"}`);
    console.log("");
  }
  console.log("Use the id of whichever one matches vMix's configured stream key as YOUTUBE_STREAM_ID.");
}
