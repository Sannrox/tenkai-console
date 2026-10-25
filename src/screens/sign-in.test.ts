import { describe, expect, it } from "vitest";
import type { OidcClientDiscovery } from "../api/tenkai.gen";
import { SIGN_IN_SUBTITLE, TOKEN_LABEL, signInButtonLabel, tokenRefusal } from "./sign-in";

const settings: OidcClientDiscovery = {
  issuer: "https://idp.example.test/realms/ops",
  audience: "tenkai",
  client_id: "tenkai-console",
  scopes: ["openid", "groups"],
};

describe("Sign-in copy", () => {
  it("puts the organisation name only on the button", () => {
    expect(SIGN_IN_SUBTITLE).toBe("Delivery");
    expect(signInButtonLabel(settings)).toBe("Sign in to idp.example.test");
    expect(signInButtonLabel({ ...settings, display_name: "Northwind" })).toBe(
      "Sign in to Northwind",
    );
  });

  it("labels the fallback as a platform token", () => {
    expect(TOKEN_LABEL).toBe("Platform token");
  });

  it("distinguishes an unrecognized token from one with no access", () => {
    expect(tokenRefusal(401)).toBe("Token not recognized.");
    expect(tokenRefusal(403)).toBe("This token is recognized and has no access.");
    expect(tokenRefusal(500)).toBeUndefined();
  });
});
