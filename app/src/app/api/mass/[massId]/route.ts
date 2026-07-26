import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { AuthError, requireRole } from "@/lib/authz";
import { AGENT_STATUS_DOC, MASSES } from "@/lib/paths";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ massId: string }> }
) {
  try {
    await requireRole(req, ["admin", "controller"]);
    const { massId } = await params;

    const [massSnap, agentSnap] = await Promise.all([
      adminDb.collection(MASSES).doc(massId).get(),
      adminDb.doc(AGENT_STATUS_DOC).get(),
    ]);

    if (!massSnap.exists) {
      return NextResponse.json({ error: "Unknown massId" }, { status: 404 });
    }

    return NextResponse.json({
      mass: { id: massSnap.id, ...massSnap.data() },
      agent: agentSnap.exists ? agentSnap.data() : null,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
