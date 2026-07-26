import type { NextRequest } from "next/server";
import { adminAuth } from "@/lib/firebaseAdmin";

export type Role = "admin" | "controller";

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function requireRole(req: NextRequest, allowed: Role[]) {
  const header = req.headers.get("authorization") || "";
  const match = header.match(/^Bearer (.+)$/);
  if (!match) throw new AuthError("Missing bearer token", 401);

  const decoded = await adminAuth.verifyIdToken(match[1]).catch(() => null);
  if (!decoded) throw new AuthError("Invalid or expired token", 401);

  const role = decoded.role as Role | undefined;
  if (!role || !allowed.includes(role)) {
    throw new AuthError(`Requires role: ${allowed.join(" or ")}`, 403);
  }

  return { uid: decoded.uid, role, name: (decoded.name as string) || decoded.uid };
}
