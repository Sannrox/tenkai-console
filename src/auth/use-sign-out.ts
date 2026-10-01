import { consoleRoot } from "../api/http";
import type { OidcClientDiscovery } from "../api/tenkai.gen";
import { signOutUrl } from "./oidc";
import { useSession } from "./session";

/** End the console session and, for OIDC, the provider session, so another account can sign in. */
export const useSignOut = (settings: OidcClientDiscovery | null) => {
  const session = useSession((state) => state.session);
  const signOut = useSession((state) => state.signOut);
  return async () => {
    const providerLogout =
      session?.kind === "oidc" && settings
        ? await signOutUrl(settings, session, consoleRoot).catch(() => null)
        : null;
    signOut();
    if (providerLogout) {
      window.location.assign(providerLogout);
    }
  };
};
