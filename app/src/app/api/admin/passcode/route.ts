import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireRole } from "@/lib/authz";
import { CONFIG_CONTROLLER_PASSCODE, setConfig } from "@/lib/store";
import { hashPasscode } from "@/lib/passcode";

/**
 * Owner rotates the shared volunteer passcode. Deliberately cannot change
 * the owner passcode — that's a setup-script job (scripts/setup/set-passcode.mjs),
 * so a stolen owner session can't lock Jason out of his own system.
 */
export async function POST(req: NextRequest) {
  try {
    const caller = await requireRole(req, ["owner"]);

    const { passcode } = (await req.json()) as { passcode?: string };
    if (!passcode?.trim()) {
      return NextResponse.json({ error: "passcode is required" }, { status: 400 });
    }

    await setConfig(CONFIG_CONTROLLER_PASSCODE, {
      hash: hashPasscode(passcode.trim()),
      updatedBy: caller.name,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[admin/passcode] failed", err);
    return NextResponse.json({ error: "Failed to set passcode" }, { status: 500 });
  }
}
