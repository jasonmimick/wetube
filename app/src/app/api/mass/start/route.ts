import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireRole } from "@/lib/authz";
import { addActivity, createMass, getActiveMass, issueCommand } from "@/lib/store";
import { createBoundBroadcast, type BroadcastVisibility } from "@/lib/youtube";

export async function POST(req: NextRequest) {
  try {
    const caller = await requireRole(req, ["owner", "controller"]);
    const { title, visibility } = (await req.json()) as {
      title: string;
      visibility: BroadcastVisibility;
    };

    if (!title || !visibility) {
      return NextResponse.json({ error: "title and visibility are required" }, { status: 400 });
    }

    // Guard that Firestore never had: refuse to open a second broadcast while
    // one is still running. Two live YouTube broadcasts bound to the same vMix
    // output is not a state the agent can act on coherently.
    const active = await getActiveMass();
    if (active) {
      return NextResponse.json(
        { error: `A broadcast is already ${active.status}. Stop it first.`, massId: active.id },
        { status: 409 }
      );
    }

    const broadcast = await createBoundBroadcast({ title, visibility });

    const mass = await createMass({
      title,
      visibility,
      youtubeVideoId: broadcast.videoId,
      embedUrl: broadcast.embedUrl,
      watchUrl: broadcast.watchUrl,
      youtubeMocked: broadcast.mocked,
      createdByName: caller.name,
    });

    await issueCommand({ type: "start", massId: mass.id, issuedBy: caller.name });
    await addActivity({
      action: "start",
      massId: mass.id,
      title,
      watchUrl: broadcast.watchUrl,
      byUid: caller.uid,
      byName: caller.name,
      byRole: caller.role,
    });

    return NextResponse.json({ massId: mass.id, ...broadcast });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[mass/start] failed", err);
    return NextResponse.json({ error: "Failed to start mass" }, { status: 500 });
  }
}
