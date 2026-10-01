import * as oauth from "oauth4webapi";
import type { OidcClientDiscovery } from "../api/tenkai.gen";
import { type Session, displaySubject } from "./session";

/**
 * Authorization Code + PKCE as a public client (ADR 0031, console#5).
 *
 * Only the PKCE verifier and `state` survive the redirect, in sessionStorage;
 * tokens never touch browser storage. Tenkai verifies every access token.
 */

const PENDING_KEY = "tenkai.oidc.pending";

type Pending = { state: string; verifier: string };

/** The exact redirect URI to register with the provider. */
export const redirectUri = (consoleRoot: URL): string => new URL("auth/callback", consoleRoot).href;

/** Button label: organisation name when the server provides one, else the issuer host. */
export const providerLabel = (settings: OidcClientDiscovery): string => {
  const named = (settings as { display_name?: unknown }).display_name;
  return typeof named === "string" && named ? named : new URL(settings.issuer).host;
};

// Tenkai only accepts plain-HTTP issuers on loopback, for development providers.
const transport = (issuer: URL) =>
  issuer.protocol === "http:" ? { [oauth.allowInsecureRequests]: true } : {};

const authorizationServer = async (settings: OidcClientDiscovery) => {
  const issuer = new URL(settings.issuer);
  const response = await oauth.discoveryRequest(issuer, {
    algorithm: "oidc",
    ...transport(issuer),
  });
  return oauth.processDiscoveryResponse(issuer, response);
};

const client = (settings: OidcClientDiscovery): oauth.Client => ({ client_id: settings.client_id });

const toSession = (tokens: oauth.TokenEndpointResponse, now: number): Session => ({
  kind: "oidc",
  accessToken: tokens.access_token,
  subject: displaySubject(tokens.id_token) ?? displaySubject(tokens.access_token),
  expiresAt: typeof tokens.expires_in === "number" ? now + tokens.expires_in * 1000 : undefined,
  refreshToken: tokens.refresh_token,
  idToken: tokens.id_token,
});

/** Build the provider's authorization URL and remember the PKCE verifier. */
export const beginSignIn = async (
  settings: OidcClientDiscovery,
  consoleRoot: URL,
  storage: Storage = sessionStorage,
): Promise<string> => {
  const as = await authorizationServer(settings);
  if (!as.authorization_endpoint) {
    throw new Error("the identity provider has no authorization endpoint");
  }
  const verifier = oauth.generateRandomCodeVerifier();
  const state = oauth.generateRandomState();
  storage.setItem(PENDING_KEY, JSON.stringify({ state, verifier } satisfies Pending));
  const url = new URL(as.authorization_endpoint);
  url.search = new URLSearchParams({
    client_id: settings.client_id,
    redirect_uri: redirectUri(consoleRoot),
    response_type: "code",
    scope: settings.scopes.join(" "),
    code_challenge: await oauth.calculatePKCECodeChallenge(verifier),
    code_challenge_method: "S256",
    state,
  }).toString();
  return url.href;
};

/** Callback failures carry what the operator needs to fix. */
export class SignInError extends Error {}

/** Exchange the callback code for tokens. The pending verifier is single use. */
export const completeSignIn = async (
  settings: OidcClientDiscovery,
  consoleRoot: URL,
  callback: URL,
  storage: Storage = sessionStorage,
  now: number = Date.now(),
): Promise<Session> => {
  const raw = storage.getItem(PENDING_KEY);
  storage.removeItem(PENDING_KEY);
  if (!raw) {
    throw new SignInError("This sign-in link is no longer valid. Start again.");
  }
  const pending = JSON.parse(raw) as Pending;
  const as = await authorizationServer(settings);
  let params: URLSearchParams;
  try {
    params = oauth.validateAuthResponse(as, client(settings), callback, pending.state);
  } catch (error) {
    const detail =
      error instanceof oauth.AuthorizationResponseError
        ? (error.error_description ?? error.error)
        : "the response did not match this sign-in";
    throw new SignInError(
      `Sign-in was rejected: ${detail}. The redirect URI registered for ${settings.client_id} must be exactly ${redirectUri(consoleRoot)}.`,
    );
  }
  const response = await oauth.authorizationCodeGrantRequest(
    as,
    client(settings),
    oauth.None(),
    params,
    redirectUri(consoleRoot),
    pending.verifier,
    transport(new URL(settings.issuer)),
  );
  return toSession(
    await oauth.processAuthorizationCodeResponse(as, client(settings), response),
    now,
  );
};

/** Renew with the in-memory refresh token. */
export const refreshSession = async (
  settings: OidcClientDiscovery,
  session: Session,
  now: number = Date.now(),
): Promise<Session> => {
  if (!session.refreshToken) {
    throw new SignInError("no refresh token");
  }
  const as = await authorizationServer(settings);
  const response = await oauth.refreshTokenGrantRequest(
    as,
    client(settings),
    oauth.None(),
    session.refreshToken,
    transport(new URL(settings.issuer)),
  );
  const tokens = await oauth.processRefreshTokenResponse(as, client(settings), response);
  return { ...toSession(tokens, now), refreshToken: tokens.refresh_token ?? session.refreshToken };
};

/** Provider logout URL when it advertises one; otherwise sign-out is local. */
export const signOutUrl = async (
  settings: OidcClientDiscovery,
  session: Session,
  consoleRoot: URL,
): Promise<string | null> => {
  const as = await authorizationServer(settings);
  if (!as.end_session_endpoint) {
    return null;
  }
  const url = new URL(as.end_session_endpoint);
  url.searchParams.set("client_id", settings.client_id);
  url.searchParams.set("post_logout_redirect_uri", consoleRoot.href);
  if (session.idToken) {
    url.searchParams.set("id_token_hint", session.idToken);
  }
  return url.href;
};
