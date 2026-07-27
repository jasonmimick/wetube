import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { AuthError, requireRole } from "@/lib/authz";
import { ACTIVITY_LOG, COMMANDS_DOC, MASSES } from "@/lib/paths";
import { createBoundBroadcast, type BroadcastVisibility } from "@/lib/youtube";

export async function POST(req: NextRequest) {
  try {
    const caller = await requireRole(req, ["admin", "controller"]);
    const { title, visibility } = (await req.json()) as {
      title: string;
      visibility: BroadcastVisibility;
    };

    if (!title || !visibility) {
      return NextResponse.json({ error: "title and visibility are required" }, { status: 400 });
    }

    const broadcast = await createBoundBroadcast({ title, visibility });

    const massRef = adminDb.collection(MASSES).doc();
    const now = new Date().toISOString();
    await massRef.set({
      title,
      visibility,
      status: "starting",
      youtubeBroadcastId: broadcast.broadcastId,
      youtubeVideoId: broadcast.videoId,
      embedUrl: broadcast.embedUrl,
      watchUrl: broadcast.watchUrl,
      youtubeMocked: broadcast.mocked,
      createdBy: caller.uid,
      createdByName: caller.name,
      createdAt: now,
      updatedAt: now,
    });

    await adminDb.doc(COMMANDS_DOC).set({
      type: "start",
      massId: massRef.id,
      issuedAt: now,
      issuedBy: caller.name,
    });

    await adminDb.collection(ACTIVITY_LOG).add({
      action: "start",
      massId: massRef.id,
      title,
      watchUrl: broadcast.watchUrl,
      byUid: caller.uid,
      byName: caller.name,
      byRole: caller.role,
      at: now,
    });

    return NextResponse.json({ massId: massRef.id, ...broadcast });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[mass/start] failed", err);
    return NextResponse.json({ error: "Failed to start mass" }, { status: 500 });
  }
}
