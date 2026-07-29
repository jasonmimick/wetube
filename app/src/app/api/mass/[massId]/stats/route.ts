import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { AuthError, requireRole } from "@/lib/authz";
import { MASSES } from "@/lib/paths";
import { getBroadcastStats } from "@/lib/youtube";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ massId: string }> }
) {
  try {
    await requireRole(req, ["admin", "controller"]);
    const { massId } = await params;

    const massSnap = await adminDb.collection(MASSES).doc(massId).get();
    if (!massSnap.exists) {
      return NextResponse.json({ error: "Unknown massId" }, { status: 404 });
    }

    const mass = massSnap.data();
    if (!mass?.youtubeVideoId || mass.youtubeMocked) {
      return NextResponse.json({ concurrentViewers: null, totalViews: null });
    }

    const stats = await getBroadcastStats(mass.youtubeVideoId);
    return NextResponse.json(stats);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
