// Firestore layout — kept in sync by hand with agent/agent.js since the
// agent is a separate Node process that doesn't share this import.
//
//   masses/{massId}       one doc per mass session
//   commands/latest       single-doc mailbox: the most recent start/stop
//                         command the agent should act on
//   agent/status          agent heartbeat + last-known vMix state
//   config/passcode       hashed shared passcode for "Mass Controller" access
//   config/emailAccess    { [lowercased email]: { role, name } } allowlist for
//                         email-link sign-in — see scripts/setup/grant-email-access.mjs
//   activityLog/{id}      append-only log of who started/stopped what

export const MASSES = "masses";
export const COMMANDS_DOC = "commands/latest";
export const AGENT_STATUS_DOC = "agent/status";
export const PASSCODE_DOC = "config/passcode";
export const EMAIL_ACCESS_DOC = "config/emailAccess";
export const ACTIVITY_LOG = "activityLog";
