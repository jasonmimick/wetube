import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession, type Role } from "@/lib/session";

export type { Role };

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * Signature is unchanged from the Firebase version on purpose — every call
 * site in the API routes keeps working. Only the innards changed: a signed
 * session cookie instead of `adminAuth.verifyIdToken` on a bearer header.
 *
 * NextRequest.cookies is synchronous (unlike the async `cookies()` helper
 * from next/headers, which is only needed when there's no request object).
 */
export async function requireRole(req: NextRequest, allowed: Role[]) {
  const session = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) throw new AuthError("Not signed in", 401);

  if (!allowed.includes(session.role)) {
    throw new AuthError(`Requires role: ${allowed.join(" or ")}`, 403);
  }

  return { uid: session.uid, role: session.role, name: session.name };
}

/**
 * The church-PC agent authenticates with a shared secret, not a session —
 * it's a machine, not a person. Same pattern as CRON_SECRET on the
 * auto-shutoff route.
 */
export function requireAgent(req: NextRequest) {
  const secret = process.env.AGENT_SHARED_SECRET;
  if (!secret) throw new AuthError("AGENT_SHARED_SECRET is not configured", 500);
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    throw new AuthError("Unauthorized", 401);
  }
}
