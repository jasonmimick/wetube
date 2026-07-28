import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { MASSES } from "@/lib/paths";
import { stopMass } from "@/lib/massActions";

const DEFAULT_HOURS = 2;

/**
 * Failsafe: auto-stops any broadcast that's been running longer than
 * AUTO_SHUTOFF_HOURS (default 2), unless an admin explicitly disabled it
 * for that broadcast via /api/mass/override. Exists to prevent someone
 * starting a stream and forgetting to stop it. Runs on a Vercel Cron
 * schedule (see vercel.json) — Vercel authenticates cron requests with
 * CRON_SECRET as a bearer token.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const hours = Number(process.env.AUTO_SHUTOFF_HOURS || DEFAULT_HOURS);
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  const snap = await adminDb
    .collection(MASSES)
    .where("status", "in", ["starting", "live", "stopping"])
    .get();

  const stopped: string[] = [];
  for (const doc of snap.docs) {
    const mass = doc.data();
    if (mass.autoShutoffDisabled) continue;
    if (!mass.createdAt || mass.createdAt > cutoff) continue;

    const result = await stopMass(doc.id, {
      uid: "system",
      name: `Auto Shutoff (${hours}hr limit)`,
      role: "system",
    });
    if (result.ok) stopped.push(doc.id);
  }

  return NextResponse.json({ checked: snap.size, stopped });
}
