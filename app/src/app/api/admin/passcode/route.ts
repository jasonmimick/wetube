import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { AuthError, requireRole } from "@/lib/authz";
import { PASSCODE_DOC } from "@/lib/paths";
import { generatePasscode, hashPasscode } from "@/lib/passcode";

export async function POST(req: NextRequest) {
  try {
    const caller = await requireRole(req, ["admin"]);

    const passcode = generatePasscode();
    await adminDb.doc(PASSCODE_DOC).set({
      hash: hashPasscode(passcode),
      updatedAt: new Date().toISOString(),
      updatedBy: caller.name,
    });

    // Returned once, in plaintext, so the admin can hand it out — it's
    // not recoverable after this since only the hash is stored.
    return NextResponse.json({ passcode });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
