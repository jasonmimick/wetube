import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireRole } from "@/lib/authz";
import { listEndedMasses } from "@/lib/store";
import { getBroadcastStatsBatch } from "@/lib/youtube";

const PAGE_SIZE = 15;

// Read-only, paginated: one row per ended mass (not per start/stop action
// the way the activity log is), with a batched YouTube view-count lookup so
// a page of history costs one API call, not one per row.
export async function GET(req: NextRequest) {
  try {
    await requireRole(req, ["owner", "controller"]);

    const cursor = req.nextUrl.searchParams.get("cursor");
    const { items: masses, hasMore } = await listEndedMasses(cursor, PAGE_SIZE);

    const videoIds = masses
      .filter((m) => m.youtubeVideoId && !m.youtubeMocked)
      .map((m) => m.youtubeVideoId as string);
    const statsById = await getBroadcastStatsBatch(videoIds);

    const items = masses.map((m) => ({
      id: m.id,
      title: m.title,
      visibility: m.visibility,
      watchUrl: m.watchUrl,
      youtubeMocked: m.youtubeMocked,
      createdByName: m.createdByName,
      createdAt: m.createdAt,
      endedAt: m.updatedAt,
      autoShutoffDisabled: m.autoShutoffDisabled,
      totalViews: (m.youtubeVideoId ? statsById[m.youtubeVideoId]?.totalViews : null) ?? null,
    }));

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
