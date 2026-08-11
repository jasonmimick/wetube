import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireRole } from "@/lib/authz";
import { getActiveMass, getAgentStatus, listActivity } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Everything the control screen needs, in one request — replaces the four
 * Firestore onSnapshot listeners (useMass, useActiveMass, useAgentStatus,
 * useActivityLog). Polled by the client every few seconds.
 *
 * One round trip instead of four live listeners is a small latency
 * downgrade and a large simplification: no realtime backend to depend on,
 * and the browser needs no database credentials at all.
 */
export async function GET(req: NextRequest) {
  try {
    await requireRole(req, ["owner", "controller"]);

    const [mass, agent, activity] = await Promise.all([
      getActiveMass(),
      getAgentStatus(),
      listActivity(20),
    ]);

    return NextResponse.json({ mass, agent, activity, serverTime: new Date().toISOString() });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[state] failed", err);
    return NextResponse.json({ error: "Failed to load state" }, { status: 500 });
  }
}
