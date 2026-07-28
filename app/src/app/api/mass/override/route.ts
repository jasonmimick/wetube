import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { AuthError, requireRole } from "@/lib/authz";
import { ACTIVITY_LOG, MASSES } from "@/lib/paths";

/**
 * Disables the 2-hour auto-shutoff failsafe for one broadcast — admin
 * only, so a volunteer can't accidentally leave the camera running
 * indefinitely without anyone noticing. See docs/AGENTS.md "Roadmap" —
 * this exists specifically to prevent "turn on and forget."
 */
export async function POST(req: NextRequest) {
  try {
    const caller = await requireRole(req, ["admin"]);
    const { massId } = (await req.json()) as { massId: string };

    if (!massId) {
      return NextResponse.json({ error: "massId is required" }, { status: 400 });
    }

    const massRef = adminDb.collection(MASSES).doc(massId);
    const snap = await massRef.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Unknown massId" }, { status: 404 });
    }

    const now = new Date().toISOString();
    await massRef.update({ autoShutoffDisabled: true, updatedAt: now });

    await adminDb.collection(ACTIVITY_LOG).add({
      action: "override-shutoff",
      massId,
      title: snap.data()?.title,
      byUid: caller.uid,
      byName: caller.name,
      byRole: caller.role,
      at: now,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[mass/override] failed", err);
    return NextResponse.json({ error: "Failed to disable auto-shutoff" }, { status: 500 });
  }
}
