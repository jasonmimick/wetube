import { NextRequest, NextResponse } from "next/server";
import {
  CONFIG_CONTROLLER_PASSCODE,
  CONFIG_OWNER_PASSCODE,
  getConfig,
} from "@/lib/store";
import { verifyPasscode } from "@/lib/passcode";
import { createSession, SESSION_COOKIE, sessionCookieOptions, type Role } from "@/lib/session";

interface StoredPasscode {
  hash: string;
  name?: string;
}

/**
 * The only sign-in path. Replaces Firebase Auth's Google popup, email-link,
 * and custom-token flows all at once.
 *
 * Which passcode you know determines your role: the owner passcode grants
 * `owner` (title/visibility curation, auto-shutoff override), the shared
 * passcode grants `controller` (start/stop only).
 */
export async function POST(req: NextRequest) {
  try {
    const { passcode, name } = (await req.json()) as { passcode?: string; name?: string };

    if (!passcode?.trim()) {
      return NextResponse.json({ error: "Passcode is required" }, { status: 400 });
    }

    const [owner, controller] = await Promise.all([
      getConfig<StoredPasscode>(CONFIG_OWNER_PASSCODE),
      getConfig<StoredPasscode>(CONFIG_CONTROLLER_PASSCODE),
    ]);

    if (!owner && !controller) {
      return NextResponse.json(
        { error: "No passcode configured yet. Run scripts/setup/set-passcode.mjs." },
        { status: 503 }
      );
    }

    let role: Role | null = null;
    let displayName = name?.trim() || "";

    // Owner first — if someone sets both passcodes to the same string, the
    // higher privilege is the safer resolution to a config mistake.
    if (owner && verifyPasscode(passcode.trim(), owner.hash)) {
      role = "owner";
      displayName = displayName || owner.name || "Owner";
    } else if (controller && verifyPasscode(passcode.trim(), controller.hash)) {
      role = "controller";
      if (!displayName) {
        return NextResponse.json({ error: "Your name is required" }, { status: 400 });
      }
    }

    if (!role) {
      return NextResponse.json({ error: "Invalid passcode" }, { status: 401 });
    }

    const { token, payload } = createSession({ role, name: displayName });

    const res = NextResponse.json({ role: payload.role, name: payload.name });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return res;
  } catch (err) {
    console.error("[auth/passcode] failed", err);
    return NextResponse.json({ error: "Sign-in temporarily unavailable" }, { status: 500 });
  }
}
