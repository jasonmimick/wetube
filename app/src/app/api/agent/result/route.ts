import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAgent } from "@/lib/authz";
import { consumeCommand, updateMass } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * The agent reports what happened after acting on a command. Marks the
 * command consumed and moves the mass to its resulting status, so a
 * half-applied command can't be replayed on the next poll.
 *
 * The mass status transition lives here rather than in the agent because
 * the agent no longer touches the database at all.
 */
export async function POST(req: NextRequest) {
  try {
    requireAgent(req);

    const { commandId, massId, type, ok, error } = (await req.json()) as {
      commandId: number;
      massId: string;
      type: "start" | "stop";
      ok: boolean;
      error?: string;
    };

    if (typeof commandId !== "number" || !massId) {
      return NextResponse.json({ error: "commandId and massId are required" }, { status: 400 });
    }

    if (ok) {
      await updateMass(massId, {
        status: type === "start" ? "live" : "ended",
        lastError: null,
      });
    } else {
      await updateMass(massId, { status: "error", lastError: error ?? "unknown error" });
    }

    await consumeCommand(commandId, ok ? null : (error ?? "unknown error"));

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[agent/result] failed", err);
    return NextResponse.json({ error: "result failed" }, { status: 500 });
  }
}
