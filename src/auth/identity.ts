import { useQuery } from "@tanstack/react-query";
import { type } from "arktype";
import { ApiError, request } from "../api/http";
import type { OidcClientDiscovery } from "../api/tenkai.gen";
import type { Session } from "./session";

// `GET /v1/auth/me` (Tenkai ADR 0047). The pinned contract predates the route,
// so the response is validated here rather than trusted as a generated type.
const AuthSession = type({
  principal: "string",
  kind: "string",
  capabilities: "string[]",
  "user?": "string",
  "groups?": "string[]",
  "source?": "string",
});

/** Who the server authenticated: capabilities always, user and OS groups for host identity. */
export type AuthSession = typeof AuthSession.infer;

/**
 * The server's view of a credential; an empty token asks about the connection
 * itself. `null` when the server refuses it or predates the route.
 */
export const fetchAuthSession = async (
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<AuthSession | null> => {
  let raw: unknown;
  try {
    raw = await request<unknown>("v1/auth/me", { token }, fetcher);
  } catch (error) {
    if (error instanceof ApiError) {
      return null;
    }
    throw error;
  }
  const session = AuthSession(raw);
  return session instanceof type.errors ? null : session;
};

/**
 * A console session for a connection the server identifies as a host account,
 * as when the console is reached through `ssh -L` to Tenkai's socket.
 */
export const hostSession = (me: AuthSession | null): Session | null =>
  me?.source === "host" && me.user
    ? {
        kind: "host",
        accessToken: "",
        subject: me.user,
        expiresAt: undefined,
        refreshToken: undefined,
        idToken: undefined,
      }
    : null;

/** Probe the connection without a credential; signs in when it is a host account. */
export const signInWithHost = async (
  signIn: (session: Session) => void,
  fetcher: typeof fetch = fetch,
): Promise<boolean> => {
  const session = hostSession(await fetchAuthSession("", fetcher));
  if (session) {
    signIn(session);
  }
  return session !== null;
};

/** The signed-in session as the server sees it, for display only. */
export const useAuthSession = (token: string | undefined) =>
  useQuery({
    queryKey: ["auth-session", token],
    queryFn: () => fetchAuthSession(token ?? ""),
    enabled: token !== undefined,
    staleTime: 60_000,
    retry: false,
  });

/** Which sign-in carries this session, in the words the account menu and Access use. */
export const signInMethod = (session: Session, settings: OidcClientDiscovery | null): string =>
  ({
    host: "host account over SSH",
    oidc: settings ? `OIDC via ${new URL(settings.issuer).host}` : "OIDC",
    token: "bearer token",
  })[session.kind];

/** A host session ends with its tunnel; the console holds nothing to discard. */
export const HOST_SIGN_OUT = "Close the SSH tunnel to sign out.";
