import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireRole } from "@/lib/authz";
import { getAgentStatus, getMass } from "@/lib/store";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ massId: string }> }
) {
  try {
    await requireRole(req, ["owner", "controller"]);
    const { massId } = await params;

    const [mass, agent] = await Promise.all([getMass(massId), getAgentStatus()]);

    if (!mass) {
      return NextResponse.json({ error: "Unknown massId" }, { status: 404 });
    }

    return NextResponse.json({ mass, agent });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
