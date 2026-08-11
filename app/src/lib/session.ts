import { createHmac, randomUUID, timingSafeEqual } from "crypto";

// Stateless signed-cookie sessions, replacing Firebase Auth entirely.
//
// There's no session table and no DB lookup on the hot path: the cookie
// carries the claims and an HMAC proves we issued it. That's the same trust
// model as the Firebase ID token it replaces (signed blob, verified per
// request), minus the vendor.
//
// Not encrypted, only signed — the payload is readable by whoever holds the
// cookie. That's fine: it contains a display name and a role the user already
// knows. Never put anything secret in here.

export const SESSION_COOKIE = "wetube_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days — volunteers shouldn't
// have to re-enter the passcode every Sunday.

export type Role = "owner" | "controller";

export interface SessionPayload {
  uid: string;
  role: Role;
  name: string;
  exp: number; // epoch seconds
}

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      "SESSION_SECRET must be set to a random string of at least 32 chars. " +
        "Generate one with: openssl rand -base64 48"
    );
  }
  return s;
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

function sign(body: string): string {
  return createHmac("sha256", secret()).update(body).digest("base64url");
}

export function createSession(input: { role: Role; name: string; uid?: string }): {
  token: string;
  payload: SessionPayload;
} {
  const payload: SessionPayload = {
    uid: input.uid ?? `${input.role}-${randomUUID()}`,
    role: input.role,
    name: input.name,
    exp: Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS,
  };
  const body = b64url(JSON.stringify(payload));
  return { token: `${body}.${sign(body)}`, payload };
}

export function verifySession(token: string | undefined): SessionPayload | null {
  if (!token) return null;

  const [body, mac] = token.split(".");
  if (!body || !mac) return null;

  // Constant-time compare. Buffer lengths must match before timingSafeEqual
  // or it throws rather than returning false.
  const expected = Buffer.from(sign(body));
  const actual = Buffer.from(mac);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as SessionPayload;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (payload.role !== "owner" && payload.role !== "controller") return null;
    return payload;
  } catch {
    return null;
  }
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  };
}
