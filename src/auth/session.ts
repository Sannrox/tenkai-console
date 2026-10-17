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

/** Where a management call applies: catalog and fleet-wide, or one environment. */
export type Scope = "fleet" | `environment:${string}`;

/** Delivery capability the server enforces after authentication. */
export type DeliveryCapability = "read" | "publish" | "management";

export type Refusal = { scope: Scope; capability: DeliveryCapability };

export const isRefused = (
  refused: Refusal[],
  scope: Scope,
  capability: DeliveryCapability,
): boolean => refused.some((entry) => entry.scope === scope && entry.capability === capability);

type SessionState = {
  session: Session | null;
  /** Why the last session ended, shown on the sign-in screen. */
  ended: "expired" | null;
  /**
   * Capability refusals for this credential. Tenkai serves no grant listing,
   * so a 403 is the only way to learn a credential lacks a capability; those
   * controls stay hidden until sign-out.
   */
  refused: Refusal[];
  signIn: (session: Session) => void;
  signOut: (reason?: "expired") => void;
  /** Records a refusal only while `token` is still the signed-in credential. */
  refuse: (token: string, scope: Scope, capability: DeliveryCapability) => void;
};

export const useSession = create<SessionState>()((set) => ({
  session: null,
  ended: null,
  refused: [],
  signIn: (session) =>
    set((state) => ({
      session,
      ended: null,
      // Only a renewal signs in over a live session; it keeps its refusals.
      refused: state.session ? state.refused : [],
    })),
  signOut: (reason) => set({ session: null, ended: reason ?? null, refused: [] }),
  refuse: (token, scope, capability) =>
    set((state) =>
      state.session?.accessToken !== token || isRefused(state.refused, scope, capability)
        ? state
        : { refused: [...state.refused, { scope, capability }] },
    ),
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
