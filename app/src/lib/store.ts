import { randomUUID } from "crypto";
import { bool, getDb, nowIso, one, type Row } from "@/lib/db";

// All Turso access lives here. Routes never write SQL directly, so the
// Firestore->SQL swap is contained to this file plus db.ts.

export const ACTIVE_STATUSES = ["starting", "live", "stopping"] as const;

export interface Mass {
  id: string;
  title: string;
  visibility: string;
  status: string;
  embedUrl: string | null;
  watchUrl: string | null;
  youtubeVideoId: string | null;
  youtubeMocked: boolean;
  lastError: string | null;
  autoShutoffDisabled: boolean;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

function toMass(r: Row): Mass {
  return {
    id: r.id as string,
    title: r.title as string,
    visibility: r.visibility as string,
    status: r.status as string,
    embedUrl: (r.embed_url as string) ?? null,
    watchUrl: (r.watch_url as string) ?? null,
    youtubeVideoId: (r.youtube_video_id as string) ?? null,
    youtubeMocked: bool(r.youtube_mocked),
    lastError: (r.last_error as string) ?? null,
    autoShutoffDisabled: bool(r.auto_shutoff_disabled),
    createdByName: (r.created_by_name as string) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

// ---------------------------------------------------------------- masses

export async function createMass(input: {
  title: string;
  visibility: string;
  youtubeVideoId?: string | null;
  embedUrl?: string | null;
  watchUrl?: string | null;
  youtubeMocked?: boolean;
  createdByName: string;
}): Promise<Mass> {
  const id = randomUUID();
  const now = nowIso();
  await getDb().execute({
    sql: `INSERT INTO masses
            (id, title, visibility, status, youtube_video_id, embed_url, watch_url,
             youtube_mocked, created_by_name, created_at, updated_at)
          VALUES (?, ?, ?, 'starting', ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      input.title,
      input.visibility,
      input.youtubeVideoId ?? null,
      input.embedUrl ?? null,
      input.watchUrl ?? null,
      input.youtubeMocked ? 1 : 0,
      input.createdByName,
      now,
      now,
    ],
  });
  return (await getMass(id))!;
}

export async function getMass(id: string): Promise<Mass | null> {
  const { rows } = await getDb().execute({
    sql: "SELECT * FROM masses WHERE id = ?",
    args: [id],
  });
  const row = one(rows as unknown as Row[]);
  return row ? toMass(row) : null;
}

/**
 * At most one mass should be non-ended at a time. Queried rather than kept
 * in a device-local pointer — a massId in one browser's localStorage is
 * invisible to every other device, so a mass started at the church would
 * never show as live on a phone.
 */
export async function getActiveMass(): Promise<Mass | null> {
  const { rows } = await getDb().execute({
    sql: `SELECT * FROM masses WHERE status IN ('starting','live','stopping')
          ORDER BY created_at DESC LIMIT 1`,
  });
  const row = one(rows as unknown as Row[]);
  return row ? toMass(row) : null;
}

export async function updateMass(
  id: string,
  patch: Partial<{
    status: string;
    lastError: string | null;
    autoShutoffDisabled: boolean;
    title: string;
    visibility: string;
  }>
): Promise<void> {
  const sets: string[] = [];
  const args: unknown[] = [];

  if (patch.status !== undefined) (sets.push("status = ?"), args.push(patch.status));
  if (patch.lastError !== undefined) (sets.push("last_error = ?"), args.push(patch.lastError));
  if (patch.title !== undefined) (sets.push("title = ?"), args.push(patch.title));
  if (patch.visibility !== undefined) (sets.push("visibility = ?"), args.push(patch.visibility));
  if (patch.autoShutoffDisabled !== undefined) {
    sets.push("auto_shutoff_disabled = ?");
    args.push(patch.autoShutoffDisabled ? 1 : 0);
  }
  if (!sets.length) return;

  sets.push("updated_at = ?");
  args.push(nowIso(), id);

  await getDb().execute({
    sql: `UPDATE masses SET ${sets.join(", ")} WHERE id = ?`,
    args: args as never[],
  });
}

/** Paginated Broadcast History: ended masses, newest first. */
export async function listEndedMasses(cursor: string | null, pageSize: number) {
  const { rows } = await getDb().execute(
    cursor
      ? {
          sql: `SELECT * FROM masses WHERE status = 'ended' AND created_at < ?
                ORDER BY created_at DESC LIMIT ?`,
          args: [cursor, pageSize + 1],
        }
      : {
          sql: `SELECT * FROM masses WHERE status = 'ended'
                ORDER BY created_at DESC LIMIT ?`,
          args: [pageSize + 1],
        }
  );
  const all = (rows as unknown as Row[]).map(toMass);
  return { items: all.slice(0, pageSize), hasMore: all.length > pageSize };
}

/** Active masses older than the cutoff — drives the auto-shutoff failsafe. */
export async function listOverdueMasses(cutoffIso: string): Promise<Mass[]> {
  const { rows } = await getDb().execute({
    sql: `SELECT * FROM masses
          WHERE status IN ('starting','live','stopping')
            AND auto_shutoff_disabled = 0
            AND created_at <= ?`,
    args: [cutoffIso],
  });
  return (rows as unknown as Row[]).map(toMass);
}

// -------------------------------------------------------------- commands

export async function issueCommand(input: {
  type: "start" | "stop";
  massId: string;
  issuedBy: string;
}): Promise<void> {
  await getDb().execute({
    sql: `INSERT INTO commands (type, mass_id, issued_at, issued_by)
          VALUES (?, ?, ?, ?)`,
    args: [input.type, input.massId, nowIso(), input.issuedBy],
  });
}

/**
 * Oldest unconsumed command. Append-only with an autoincrement id, so the
 * agent no longer has to compare ISO timestamp strings to work out whether
 * it already handled something across a restart.
 */
export async function nextCommand() {
  const { rows } = await getDb().execute(
    `SELECT id, type, mass_id, issued_at, issued_by FROM commands
     WHERE consumed_at IS NULL ORDER BY id LIMIT 1`
  );
  const row = one(rows as unknown as Row[]);
  if (!row) return null;
  return {
    id: Number(row.id),
    type: row.type as "start" | "stop",
    massId: row.mass_id as string,
    issuedAt: row.issued_at as string,
    issuedBy: row.issued_by as string,
  };
}

export async function consumeCommand(id: number, resultError?: string | null) {
  await getDb().execute({
    sql: "UPDATE commands SET consumed_at = ?, result_error = ? WHERE id = ?",
    args: [nowIso(), resultError ?? null, id],
  });
}

// ---------------------------------------------------------- agent status

export interface AgentStatus {
  lastHeartbeatAt: string | null;
  vmixConnected: boolean | null;
  streaming: boolean;
  lastCommand: string | null;
  lastError: string | null;
}

export async function getAgentStatus(): Promise<AgentStatus> {
  const { rows } = await getDb().execute("SELECT * FROM agent_status WHERE id = 1");
  const r = one(rows as unknown as Row[]);
  return {
    lastHeartbeatAt: (r?.last_heartbeat_at as string) ?? null,
    vmixConnected: r?.vmix_connected == null ? null : bool(r.vmix_connected),
    streaming: bool(r?.streaming),
    lastCommand: (r?.last_command as string) ?? null,
    lastError: (r?.last_error as string) ?? null,
  };
}

/**
 * Server-side heartbeat throttling — the fix for the 2026-08-10 quota
 * outage. The agent may poll every 3s for command responsiveness, but this
 * row is only rewritten when a material field actually changed or the last
 * write is older than `throttleMs`.
 *
 * Done as ONE conditional UPDATE rather than read-then-write: serverless
 * invocations share no memory, so the freshness check has to live in the
 * statement. `IS NOT` is SQLite's null-safe comparison, so a NULL->NULL
 * field correctly counts as unchanged.
 */
export async function recordHeartbeat(
  patch: {
    vmixConnected: boolean | null;
    streaming: boolean;
    lastCommand?: string | null;
    lastError?: string | null;
  },
  throttleMs = 30_000
): Promise<{ written: boolean }> {
  const now = nowIso();
  const cutoff = new Date(Date.now() - throttleMs).toISOString();
  const vmix = patch.vmixConnected == null ? null : patch.vmixConnected ? 1 : 0;
  const streaming = patch.streaming ? 1 : 0;
  const lastCommand = patch.lastCommand ?? null;
  const lastError = patch.lastError ?? null;

  const res = await getDb().execute({
    sql: `UPDATE agent_status
             SET last_heartbeat_at = ?, vmix_connected = ?, streaming = ?,
                 last_command = ?, last_error = ?
           WHERE id = 1
             AND (last_heartbeat_at IS NULL
                  OR last_heartbeat_at < ?
                  OR vmix_connected IS NOT ?
                  OR streaming IS NOT ?
                  OR last_command IS NOT ?
                  OR last_error IS NOT ?)`,
    args: [
      now, vmix, streaming, lastCommand, lastError,
      cutoff, vmix, streaming, lastCommand, lastError,
    ],
  });

  return { written: res.rowsAffected > 0 };
}

// -------------------------------------------------------- activity log

export async function addActivity(entry: {
  action: string;
  massId?: string | null;
  title?: string | null;
  watchUrl?: string | null;
  byUid: string;
  byName: string;
  byRole: string;
}): Promise<void> {
  await getDb().execute({
    sql: `INSERT INTO activity_log
            (action, mass_id, title, watch_url, by_uid, by_name, by_role, at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      entry.action,
      entry.massId ?? null,
      entry.title ?? null,
      entry.watchUrl ?? null,
      entry.byUid,
      entry.byName,
      entry.byRole,
      nowIso(),
    ],
  });
}

export async function listActivity(max = 20) {
  const { rows } = await getDb().execute({
    sql: `SELECT id, action, mass_id, title, watch_url, by_name, by_role, at
          FROM activity_log ORDER BY at DESC LIMIT ?`,
    args: [max],
  });
  return (rows as unknown as Row[]).map((r) => ({
    id: String(r.id),
    action: r.action as string,
    massId: (r.mass_id as string) ?? "",
    title: (r.title as string) ?? undefined,
    watchUrl: (r.watch_url as string) ?? undefined,
    byName: (r.by_name as string) ?? "",
    byRole: (r.by_role as string) ?? "",
    at: r.at as string,
  }));
}

// ------------------------------------------------------------------ config

export async function getConfig<T = unknown>(key: string): Promise<T | null> {
  const { rows } = await getDb().execute({
    sql: "SELECT value FROM config WHERE key = ?",
    args: [key],
  });
  const r = one(rows as unknown as Row[]);
  if (!r) return null;
  try {
    return JSON.parse(r.value as string) as T;
  } catch {
    return null;
  }
}

export async function setConfig(key: string, value: unknown): Promise<void> {
  await getDb().execute({
    sql: `INSERT INTO config (key, value, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    args: [key, JSON.stringify(value), nowIso()],
  });
}

export const CONFIG_OWNER_PASSCODE = "owner_passcode";
export const CONFIG_CONTROLLER_PASSCODE = "controller_passcode";
