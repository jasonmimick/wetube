import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireRole } from "@/lib/authz";
import { stopMass } from "@/lib/massActions";

export async function POST(req: NextRequest) {
  try {
    const caller = await requireRole(req, ["admin", "controller"]);
    const { massId } = (await req.json()) as { massId: string };

    if (!massId) {
      return NextResponse.json({ error: "massId is required" }, { status: 400 });
    }

    const result = await stopMass(massId, { uid: caller.uid, name: caller.name, role: caller.role });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[mass/stop] failed", err);
    return NextResponse.json({ error: "Failed to stop mass" }, { status: 500 });
  }
}
