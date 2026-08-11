import { createClient, type Client } from "@libsql/client/web";

// Lazy singleton. Deliberately NOT initialized at module scope: doing that
// throws during `next build` when env vars aren't present, which is exactly
// the failure mode Firebase had (see AGENTS.md — "Firebase Auth client SDK
// breaks SSR/prerendering"). Nothing here runs until a request handler
// actually asks for the client.
let client: Client | null = null;

export function getDb(): Client {
  if (client) return client;

  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url) {
    throw new Error(
      "TURSO_DATABASE_URL is not set. Add it in the Vercel dashboard (or .env.local " +
        "for dev) — see docs/DESIGN-drop-firebase.md."
    );
  }

  // The /web entrypoint is HTTP-only: no native bindings, no persistent
  // sockets. That's what makes it safe in serverless functions, where a
  // connection can't outlive the invocation anyway.
  client = createClient({ url, authToken });
  return client;
}

/** Rows come back as untyped records; this just narrows the cast at call sites. */
export type Row = Record<string, unknown>;

export function one<T = Row>(rows: Row[]): T | null {
  return (rows[0] as T) ?? null;
}

/** SQLite has no boolean type — columns are INTEGER 0/1. */
export function bool(v: unknown): boolean {
  return v === 1 || v === "1" || v === true;
}

export function nowIso(): string {
  return new Date().toISOString();
}
