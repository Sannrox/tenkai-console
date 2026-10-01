// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OidcClientDiscovery } from "../api/tenkai.gen";
import { SignInError, beginSignIn, completeSignIn, providerLabel, redirectUri } from "./oidc";

const ISSUER = "https://idp.example.test/realms/ops";
const settings: OidcClientDiscovery = {
  issuer: ISSUER,
  audience: "tenkai",
  client_id: "tenkai-console",
  scopes: ["openid", "groups"],
};
const root = new URL("https://hub.test/ui/");

const b64 = (value: unknown) =>
  btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

/** A provider stub: discovery plus a token endpoint that records its request. */
const provider = () => {
  const seen: { tokenBody?: URLSearchParams } = {};
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.pathname.endsWith("/.well-known/openid-configuration")) {
      return Response.json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/auth`,
        token_endpoint: `${ISSUER}/token`,
        end_session_endpoint: `${ISSUER}/logout`,
      });
    }
    if (url.pathname.endsWith("/token")) {
      const body = init?.body;
      seen.tokenBody =
        body instanceof URLSearchParams
          ? body
          : new URLSearchParams(typeof body === "string" ? body : "");
      return Response.json({
        access_token: `${b64({ alg: "none" })}.${b64({ preferred_username: "ada" })}.sig`,
        token_type: "Bearer",
        expires_in: 300,
        refresh_token: "r-1",
      });
    }
    return new Response("not found", { status: 404 });
  });
  return seen;
};

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe("OIDC sign-in", () => {
  it("labels the button with the organisation name, else the issuer host", () => {
    expect(providerLabel(settings)).toBe("idp.example.test");
    expect(providerLabel({ ...settings, display_name: "Example Org" } as OidcClientDiscovery)).toBe(
      "Example Org",
    );
  });

  it("starts Authorization Code with S256 PKCE and the exact redirect URI", async () => {
    provider();
    const url = new URL(await beginSignIn(settings, root));
    expect(url.origin + url.pathname).toBe(`${ISSUER}/auth`);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: "tenkai-console",
      redirect_uri: "https://hub.test/ui/auth/callback",
      response_type: "code",
      scope: "openid groups",
      code_challenge_method: "S256",
    });
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("exchanges the code with the stored verifier and keeps tokens out of storage", async () => {
    const seen = provider();
    const state = new URL(await beginSignIn(settings, root)).searchParams.get("state");
    const callback = new URL(`${redirectUri(root)}?code=c-1&state=${state}`);
    const session = await completeSignIn(settings, root, callback, sessionStorage, 1_000);

    expect(seen.tokenBody?.get("code")).toBe("c-1");
    expect(seen.tokenBody?.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(seen.tokenBody?.get("redirect_uri")).toBe(redirectUri(root));
    expect(session).toMatchObject({
      kind: "oidc",
      subject: "ada",
      expiresAt: 301_000,
      refreshToken: "r-1",
    });
    expect(sessionStorage.length).toBe(0);
  });

  it("rejects a forged state and names the redirect URI to register", async () => {
    provider();
    await beginSignIn(settings, root);
    const error = await completeSignIn(
      settings,
      root,
      new URL(`${redirectUri(root)}?code=c-1&state=forged`),
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SignInError);
    expect(String(error)).toContain("https://hub.test/ui/auth/callback");
  });

  it("refuses a replayed callback after the verifier was used", async () => {
    provider();
    const error = await completeSignIn(
      settings,
      root,
      new URL(`${redirectUri(root)}?code=c-1&state=s`),
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SignInError);
  });
});
