import { google } from "googleapis";

export type BroadcastVisibility = "public" | "unlisted" | "private";

export interface CreatedBroadcast {
  broadcastId: string;
  videoId: string;
  embedUrl: string;
  watchUrl: string;
  mocked: boolean;
}

function hasRealCredentials() {
  return Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
      process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
      process.env.GOOGLE_OAUTH_REFRESH_TOKEN &&
      process.env.YOUTUBE_STREAM_ID
  );
}

/**
 * Creates a new YouTube live broadcast bound to the church's existing,
 * unchanging stream key, with autoStart/autoStop so YouTube flips it live
 * the moment vMix starts pushing video (see docs/DESIGN-stream-control.md).
 *
 * Falls back to a mock broadcast when real OAuth credentials aren't
 * configured, so the rest of the app is testable without them.
 */
export async function createBoundBroadcast({
  title,
  visibility,
}: {
  title: string;
  visibility: BroadcastVisibility;
}): Promise<CreatedBroadcast> {
  if (!hasRealCredentials()) {
    const fakeId = `mock-${Date.now()}`;
    console.warn(
      "[youtube] MOCK MODE — no GOOGLE_OAUTH_* / YOUTUBE_STREAM_ID env vars set, returning a fake broadcast"
    );
    return {
      broadcastId: fakeId,
      videoId: fakeId,
      embedUrl: `https://www.youtube.com/embed/${fakeId}`,
      watchUrl: `https://www.youtube.com/watch?v=${fakeId}`,
      mocked: true,
    };
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN });

  const youtube = google.youtube({ version: "v3", auth: oauth2Client });

  const insertRes = await youtube.liveBroadcasts.insert({
    part: ["snippet", "status", "contentDetails"],
    requestBody: {
      snippet: {
        title,
        scheduledStartTime: new Date().toISOString(),
      },
      status: { privacyStatus: visibility },
      contentDetails: {
        enableAutoStart: true,
        enableAutoStop: true,
      },
    },
  });

  const broadcastId = insertRes.data.id;
  if (!broadcastId) throw new Error("YouTube did not return a broadcast id");

  await youtube.liveBroadcasts.bind({
    id: broadcastId,
    part: ["id"],
    streamId: process.env.YOUTUBE_STREAM_ID,
  });

  return {
    broadcastId,
    videoId: broadcastId,
    embedUrl: `https://www.youtube.com/embed/${broadcastId}`,
    watchUrl: `https://www.youtube.com/watch?v=${broadcastId}`,
    mocked: false,
  };
}

export interface BroadcastStats {
  concurrentViewers: number | null;
  totalViews: number | null;
}

/**
 * concurrentViewers only exists while a broadcast is actually live; it
 * disappears from the API response once the stream ends (totalViews
 * — the lifetime view count — takes over from there). Both come back
 * null if the broadcast has neither yet (e.g. still starting).
 */
export async function getBroadcastStats(videoId: string): Promise<BroadcastStats> {
  if (!hasRealCredentials()) {
    return { concurrentViewers: null, totalViews: null };
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN });

  const youtube = google.youtube({ version: "v3", auth: oauth2Client });
  const res = await youtube.videos.list({
    part: ["liveStreamingDetails", "statistics"],
    id: [videoId],
  });

  const video = res.data.items?.[0];
  const concurrent = video?.liveStreamingDetails?.concurrentViewers;
  const views = video?.statistics?.viewCount;

  return {
    concurrentViewers: concurrent != null ? Number(concurrent) : null,
    totalViews: views != null ? Number(views) : null,
  };
}
