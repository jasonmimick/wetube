import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { AuthError, requireRole } from "@/lib/authz";
import { ACTIVITY_LOG, COMMANDS_DOC, MASSES } from "@/lib/paths";

export async function POST(req: NextRequest) {
  try {
    const caller = await requireRole(req, ["admin", "controller"]);
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
    await massRef.update({ status: "stopping", updatedAt: now });

    await adminDb.doc(COMMANDS_DOC).set({
      type: "stop",
      massId,
      issuedAt: now,
      issuedBy: caller.name,
    });

    await adminDb.collection(ACTIVITY_LOG).add({
      action: "stop",
      massId,
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
    console.error("[mass/stop] failed", err);
    return NextResponse.json({ error: "Failed to stop mass" }, { status: 500 });
  }
}
