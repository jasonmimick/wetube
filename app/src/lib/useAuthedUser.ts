"use client";

import { onIdTokenChanged, type User } from "firebase/auth";
import { useEffect, useState } from "react";
import { auth } from "@/lib/firebaseClient";

export type Role = "admin" | "controller" | null;

export interface AuthedUser {
  status: "loading" | "signed-out" | "signed-in";
  user: User | null;
  role: Role;
  name: string | null;
}

export function useAuthedUser(): AuthedUser {
  const [state, setState] = useState<AuthedUser>({
    status: "loading",
    user: null,
    role: null,
    name: null,
  });

  useEffect(() => {
    return onIdTokenChanged(auth, async (user) => {
      if (!user) {
        setState({ status: "signed-out", user: null, role: null, name: null });
        return;
      }
      const result = await user.getIdTokenResult();
      setState({
        status: "signed-in",
        user,
        role: (result.claims.role as Role) ?? null,
        name: (result.claims.name as string) ?? user.displayName ?? user.email ?? "Unknown",
      });
    });
  }, []);

  return state;
}
