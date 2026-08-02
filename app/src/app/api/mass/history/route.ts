import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { AuthError, requireRole } from "@/lib/authz";
import { MASSES } from "@/lib/paths";
import { getBroadcastStatsBatch } from "@/lib/youtube";

const PAGE_SIZE = 15;

// Read-only, paginated: one row per ended mass (not per start/stop action
// the way activityLog is), with a batched YouTube view-count lookup so a
// page of history costs one API call, not one per row. Doesn't touch the
// start/stop write path at all.
export async function GET(req: NextRequest) {
  try {
    await requireRole(req, ["admin", "controller"]);

    const cursor = req.nextUrl.searchParams.get("cursor");
    let q = adminDb
      .collection(MASSES)
      .where("status", "==", "ended")
      .orderBy("createdAt", "desc")
      .limit(PAGE_SIZE + 1);
    if (cursor) q = q.startAfter(cursor);

    const snap = await q.get();
    const docs = snap.docs.slice(0, PAGE_SIZE);
    const hasMore = snap.docs.length > PAGE_SIZE;

    const videoIds = docs
      .map((d) => d.data())
      .filter((m) => m.youtubeVideoId && !m.youtubeMocked)
      .map((m) => m.youtubeVideoId as string);
    const statsById = await getBroadcastStatsBatch(videoIds);

    const items = docs.map((d) => {
      const m = d.data();
      const stats = m.youtubeVideoId ? statsById[m.youtubeVideoId] : undefined;
      return {
        id: d.id,
        title: m.title,
        visibility: m.visibility,
        watchUrl: m.watchUrl,
        youtubeMocked: m.youtubeMocked ?? false,
        createdByName: m.createdByName,
        createdAt: m.createdAt,
        endedAt: m.updatedAt,
        autoShutoffDisabled: m.autoShutoffDisabled ?? false,
        totalViews: stats?.totalViews ?? null,
      };
    });

    return NextResponse.json({
      items,
      nextCursor: hasMore ? items[items.length - 1]?.createdAt : null,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[mass/history] failed", err);
    return NextResponse.json({ error: "Failed to load history" }, { status: 500 });
  }
}
