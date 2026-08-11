import { NextRequest, NextResponse } from "next/server";
import { listOverdueMasses } from "@/lib/store";
import { stopMass } from "@/lib/massActions";

const DEFAULT_HOURS = 2;

/**
 * Failsafe: auto-stops any broadcast running longer than AUTO_SHUTOFF_HOURS
 * (default 2), unless the owner explicitly disabled it for that broadcast
 * via /api/mass/override. Exists to prevent someone starting a stream and
 * forgetting to stop it.
 *
 * Triggered by a GitHub Actions scheduled workflow, NOT Vercel Cron —
 * Vercel's Hobby plan only allows daily crons and fails the entire
 * deployment if you exceed that. See .github/workflows/auto-shutoff.yml
 * and AGENTS.md.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const hours = Number(process.env.AUTO_SHUTOFF_HOURS || DEFAULT_HOURS);
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  // The auto_shutoff_disabled and age filters are both in SQL now, so this
  // no longer reads every active mass and filters in JS.
  const overdue = await listOverdueMasses(cutoff);

  const stopped: string[] = [];
  for (const mass of overdue) {
    const result = await stopMass(mass.id, {
      uid: "system",
      name: `Auto Shutoff (${hours}hr limit)`,
      role: "system",
    });
    if (result.ok) stopped.push(mass.id);
  }

  return NextResponse.json({ checked: overdue.length, stopped });
}
