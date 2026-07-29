import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { AuthError, requireRole } from "@/lib/authz";
import { PASSCODE_DOC } from "@/lib/paths";
import { hashPasscode } from "@/lib/passcode";

export async function POST(req: NextRequest) {
  try {
    const caller = await requireRole(req, ["admin"]);

    const { passcode } = await req.json();
    if (!passcode || typeof passcode !== "string" || !passcode.trim()) {
      return NextResponse.json({ error: "passcode is required" }, { status: 400 });
    }

    await adminDb.doc(PASSCODE_DOC).set({
      hash: hashPasscode(passcode.trim()),
      updatedAt: new Date().toISOString(),
      updatedBy: caller.name,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
