import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireRole } from "@/lib/authz";
import { getMass } from "@/lib/store";
import { getBroadcastStats } from "@/lib/youtube";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ massId: string }> }
) {
  try {
    await requireRole(req, ["owner", "controller"]);
    const { massId } = await params;

    const mass = await getMass(massId);
    if (!mass) {
      return NextResponse.json({ error: "Unknown massId" }, { status: 404 });
    }

    if (!mass.youtubeVideoId || mass.youtubeMocked) {
      return NextResponse.json({ concurrentViewers: null, totalViews: null });
    }

    return NextResponse.json(await getBroadcastStats(mass.youtubeVideoId));
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
