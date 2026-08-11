import { addActivity, getMass, issueCommand, updateMass } from "@/lib/store";

/**
 * Core "stop this mass" write — shared between the real /api/mass/stop
 * route (a human pressed Stop) and the auto-shutoff cron job (nobody
 * pressed anything, the 2-hour failsafe fired). Same writes either way;
 * only who gets credited in the activity log differs.
 */
export async function stopMass(
  massId: string,
  by: { uid: string; name: string; role: string }
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const mass = await getMass(massId);
  if (!mass) {
    return { ok: false, error: "Unknown massId", status: 404 };
  }

  await updateMass(massId, { status: "stopping" });
  await issueCommand({ type: "stop", massId, issuedBy: by.name });
  await addActivity({
    action: "stop",
    massId,
    title: mass.title,
    watchUrl: mass.watchUrl,
    byUid: by.uid,
    byName: by.name,
    byRole: by.role,
  });

  return { ok: true };
}
