import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireRole } from "@/lib/authz";
import { addActivity, getMass, updateMass } from "@/lib/store";

/**
 * Disables the 2-hour auto-shutoff failsafe for one broadcast — owner
 * only, so a volunteer can't accidentally leave the camera running
 * indefinitely without anyone noticing.
 */
export async function POST(req: NextRequest) {
  try {
    const caller = await requireRole(req, ["owner"]);
    const { massId } = (await req.json()) as { massId: string };

    if (!massId) {
      return NextResponse.json({ error: "massId is required" }, { status: 400 });
    }

    const mass = await getMass(massId);
    if (!mass) {
      return NextResponse.json({ error: "Unknown massId" }, { status: 404 });
    }

    await updateMass(massId, { autoShutoffDisabled: true });
    await addActivity({
      action: "override-shutoff",
      massId,
      title: mass.title,
      byUid: caller.uid,
      byName: caller.name,
      byRole: caller.role,
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
