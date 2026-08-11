"use client";

import { useCallback, useEffect, useState } from "react";

export type Role = "owner" | "controller" | null;

export interface AuthedUser {
  status: "loading" | "signed-out" | "signed-in";
  role: Role;
  name: string | null;
}

/**
 * Replaces Firebase's onIdTokenChanged. The session cookie is httpOnly so
 * the browser can't inspect it directly — it asks /api/auth/session instead.
 *
 * There's no token to thread through components any more: the cookie rides
 * along on every same-origin fetch automatically, so API calls just work.
 */
export function useAuthedUser() {
  const [state, setState] = useState<AuthedUser>({
    status: "loading",
    role: null,
    name: null,
  });

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/session");
      const data = await res.json();
      setState({
        status: data.status === "signed-in" ? "signed-in" : "signed-out",
        role: data.role ?? null,
        name: data.name ?? null,
      });
    } catch {
      setState({ status: "signed-out", role: null, name: null });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/session", { method: "DELETE" });
    setState({ status: "signed-out", role: null, name: null });
  }, []);

  return { ...state, refresh, signOut };
}
