import { create } from "zustand";

/**
 * The signed-in credential. Held in memory only: never written to storage,
 * so a reload signs in again.
 */
export type Session = {
  kind: "oidc" | "token";
  accessToken: string;
  /** Display only; the server decides authorization. */
  subject: string | undefined;
  expiresAt: number | undefined;
  refreshToken: string | undefined;
  idToken: string | undefined;
};

type SessionState = {
  session: Session | null;
  /** Why the last session ended, shown on the sign-in screen. */
  ended: "expired" | null;
  signIn: (session: Session) => void;
  signOut: (reason?: "expired") => void;
};

export const useSession = create<SessionState>()((set) => ({
  session: null,
  ended: null,
  signIn: (session) => set({ session, ended: null }),
  signOut: (reason) => set({ session: null, ended: reason ?? null }),
}));

/** Unverified display claims from a JWT payload; never used for decisions. */
export const displaySubject = (jwt: string | undefined): string | undefined => {
  const payload = jwt?.split(".")[1];
  if (!payload) {
    return undefined;
  }
  try {
    const claims: unknown = JSON.parse(atob(payload.replaceAll("-", "+").replaceAll("_", "/")));
    if (typeof claims !== "object" || claims === null) {
      return undefined;
    }
    for (const key of ["preferred_username", "email", "name", "sub"]) {
      const value = (claims as Record<string, unknown>)[key];
      if (typeof value === "string" && value) {
        return value;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
};
