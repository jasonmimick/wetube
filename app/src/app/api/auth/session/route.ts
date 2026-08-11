import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

/**
 * Replaces Firebase's onIdTokenChanged. The session cookie is httpOnly, so
 * the browser can't read it directly — it asks here instead. Called once on
 * mount by useAuthedUser().
 */
export async function GET(req: NextRequest) {
  const session = verifySession(req.cookies.get(SESSION_COOKIE)?.value);

  if (!session) {
    return NextResponse.json({ status: "signed-out", role: null, name: null });
  }

  return NextResponse.json({
    status: "signed-in",
    role: session.role,
    name: session.name,
    uid: session.uid,
  });
}

/** Sign out. */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
