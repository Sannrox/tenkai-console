import { useEffect } from "react";
import type { OidcClientDiscovery } from "../api/tenkai.gen";
import { refreshSession } from "./oidc";
import { useSession } from "./session";

const EARLY_MS = 60_000;

/** Renew an OIDC session shortly before expiry; end it when renewal is impossible. */
export const useSessionRefresh = (settings: OidcClientDiscovery | null) => {
  const session = useSession((state) => state.session);
  const signIn = useSession((state) => state.signIn);
  const signOut = useSession((state) => state.signOut);

  useEffect(() => {
    const expiresAt = session?.expiresAt;
    if (!session || expiresAt === undefined) {
      return () => {};
    }
    const renewable =
      session.kind === "oidc" && session.refreshToken !== undefined && settings !== null;
    const timer = setTimeout(
      () => {
        if (!renewable) {
          signOut("expired");
          return;
        }
        refreshSession(settings, session).then(signIn, () => signOut("expired"));
      },
      Math.max(0, (renewable ? expiresAt - EARLY_MS : expiresAt) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [session, settings, signIn, signOut]);
};
