// Local plaintext passcode cheat sheet.
//
// The database stores only an irreversible scrypt hash, so without this file
// a forgotten passcode can only be overwritten, never looked up. This is
// written at the one moment the plaintext is known — when it's being set.
//
// Kept in its own module so it can be tested without running the real
// set-passcode flow against the live database.

import { chmodSync, readFileSync, writeFileSync } from "node:fs";

const HEADER = `# wetube passcodes — LOCAL ONLY

Plaintext, on purpose: the database stores only an irreversible scrypt hash,
so this file is the only way to look a passcode up rather than reset it.

Gitignored and chmod 600. **This repo is public** — never commit this file,
and never paste its contents into a chat, an issue, or a screenshot.

- App: https://wetube-mu.vercel.app
- Reset either passcode: \`node scripts/setup/set-passcode.mjs <owner|controller>\`
- The volunteer passcode can also be rotated in-app from the Admin panel.

| role | passcode | set at |
|---|---|---|
`;

export function labelFor(role) {
  return role === "owner" ? "owner (you)" : "controller (volunteers)";
}

/**
 * Adds or replaces the row for `role`. Returns the file contents so callers
 * (and tests) can assert on the result without re-reading.
 */
export function renderCheatSheet(existing, role, passcode, now = new Date().toISOString()) {
  const label = labelFor(role);
  const base = existing && existing.includes("| role |") ? existing : HEADER;
  const row = `| ${label} | \`${passcode}\` | ${now} |`;

  // Escape regex metacharacters in the label — "owner (you)" has parens.
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rowPattern = new RegExp(`^\\| ${escaped} \\|.*$`, "m");

  return rowPattern.test(base)
    ? base.replace(rowPattern, row)
    : base.trimEnd() + "\n" + row + "\n";
}

export function writeCheatSheet(path, role, passcode) {
  let existing = "";
  try {
    existing = readFileSync(path, "utf8");
  } catch {
    // first run — renderCheatSheet supplies the header
  }
  writeFileSync(path, renderCheatSheet(existing, role, passcode), { mode: 0o600 });
  chmodSync(path, 0o600); // writeFileSync won't chmod an existing file
  return path;
}
