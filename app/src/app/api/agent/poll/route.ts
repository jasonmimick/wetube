import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAgent } from "@/lib/authz";
import { nextCommand, recordHeartbeat } from "@/lib/store";

// Never cache: the agent polls this every few seconds for fresh commands.
export const dynamic = "force-dynamic";

const HEARTBEAT_THROTTLE_MS = Number(process.env.HEARTBEAT_THROTTLE_MS || 30_000);

/**
 * The church PC's only endpoint. One request does both jobs that used to be
 * two Firestore round-trips: record the heartbeat, and fetch any pending
 * command.
 *
 * The heartbeat write is throttled HERE rather than in the agent, so poll
 * frequency (responsiveness) and write frequency (cost) are independent.
 * The agent can poll every 3s and still only cause a DB write every 30s —
 * that coupling is what exhausted the Firestore quota on 2026-08-10.
 */
export async function POST(req: NextRequest) {
  try {
    requireAgent(req);

    const body = (await req.json().catch(() => ({}))) as {
      vmixConnected?: boolean | null;
      streaming?: boolean;
      lastCommand?: string | null;
      lastError?: string | null;
    };

    const { written } = await recordHeartbeat(
      {
        vmixConnected: body.vmixConnected ?? null,
        streaming: body.streaming ?? false,
        lastCommand: body.lastCommand ?? null,
        lastError: body.lastError ?? null,
      },
      HEARTBEAT_THROTTLE_MS
    );

    const command = await nextCommand();

    return NextResponse.json({ command, heartbeatWritten: written });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[agent/poll] failed", err);
    return NextResponse.json({ error: "poll failed" }, { status: 500 });
  }
}
