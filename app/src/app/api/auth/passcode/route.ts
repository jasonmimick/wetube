import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { PASSCODE_DOC } from "@/lib/paths";
import { verifyPasscode } from "@/lib/passcode";

export async function POST(req: NextRequest) {
  try {
    const { passcode, name } = await req.json();

    if (!passcode || !name) {
      return NextResponse.json({ error: "passcode and name are required" }, { status: 400 });
    }

    const doc = await adminDb.doc(PASSCODE_DOC).get();
    const stored = doc.exists ? (doc.data()?.hash as string) : null;

    if (!stored || !verifyPasscode(passcode, stored)) {
      return NextResponse.json({ error: "Invalid passcode" }, { status: 401 });
    }

    const uid = `controller-${randomUUID()}`;
    const token = await adminAuth.createCustomToken(uid, {
      role: "controller",
      name,
    });

    return NextResponse.json({ token });
  } catch (err) {
    console.error("[auth/passcode] failed", err);
    return NextResponse.json({ error: "Sign-in temporarily unavailable" }, { status: 500 });
  }
}
