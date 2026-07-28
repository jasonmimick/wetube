import { adminDb } from "@/lib/firebaseAdmin";
import { ACTIVITY_LOG, COMMANDS_DOC, MASSES } from "@/lib/paths";

/**
 * Core "stop this mass" write — shared between the real /api/mass/stop
 * route (a human pressed Stop) and the auto-shutoff cron job (nobody
 * pressed anything, the 2-hour failsafe fired). Same Firestore writes
 * either way; only who gets credited in the activity log differs.
 */
export async function stopMass(
  massId: string,
  by: { uid: string; name: string; role: string }
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const massRef = adminDb.collection(MASSES).doc(massId);
  const snap = await massRef.get();
  if (!snap.exists) {
    return { ok: false, error: "Unknown massId", status: 404 };
  }

  const now = new Date().toISOString();
  await massRef.update({ status: "stopping", updatedAt: now });

  await adminDb.doc(COMMANDS_DOC).set({
    type: "stop",
    massId,
    issuedAt: now,
    issuedBy: by.name,
  });

  const mass = snap.data();
  await adminDb.collection(ACTIVITY_LOG).add({
    action: "stop",
    massId,
    title: mass?.title,
    watchUrl: mass?.watchUrl,
    byUid: by.uid,
    byName: by.name,
    byRole: by.role,
    at: now,
  });

  return { ok: true };
}
