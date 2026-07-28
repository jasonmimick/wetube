import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { EMAIL_ACCESS_DOC } from "@/lib/paths";

// Called by the client right after completing Firebase's email-link
// sign-in. That sign-in alone proves control of an inbox, not that the
// person should get any app role — this route is the gate: it only grants
// a role if the signed-in email is on the config/emailAccess allowlist
// (managed via scripts/setup/grant-email-access.mjs), same spirit as
// set-admin-claim.mjs for Google sign-in.
export async function POST(req: NextRequest) {
  try {
    const header = req.headers.get("authorization") || "";
    const match = header.match(/^Bearer (.+)$/);
    if (!match) {
      return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
    }

    const decoded = await adminAuth.verifyIdToken(match[1]).catch(() => null);
    if (!decoded || !decoded.email) {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    const email = decoded.email.toLowerCase();
    const doc = await adminDb.doc(EMAIL_ACCESS_DOC).get();
    const entry = doc.exists ? doc.data()?.[email] : null;

    if (!entry || !entry.role) {
      return NextResponse.json(
        { error: `${email} is not on the email-access allowlist` },
        { status: 403 }
      );
    }

    const name = entry.name || decoded.name || email;
    await adminAuth.setCustomUserClaims(decoded.uid, { role: entry.role, name });

    return NextResponse.json({ role: entry.role, name });
  } catch (err) {
    console.error("[auth/email-link/claim] failed", err);
    return NextResponse.json({ error: "Sign-in temporarily unavailable" }, { status: 500 });
  }
}
