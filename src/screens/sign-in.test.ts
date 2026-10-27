import { describe, expect, it } from "vitest";
import type { OidcClientDiscovery } from "../api/tenkai.gen";
import { TEAM_NOTE, TOKEN_LABEL, signInButtonLabel, signInHeading, tokenRefusal } from "./sign-in";

const settings: OidcClientDiscovery = {
  issuer: "https://idp.example.test/realms/ops",
  audience: "tenkai",
  client_id: "tenkai-console",
  scopes: ["openid", "groups"],
};

describe("Sign-in copy", () => {
  it("makes the organisation the title and names it on the button (#30, pick A)", () => {
    expect(signInHeading(settings)).toEqual({
      title: "idp.example.test",
      subtitle: "Tenkai delivery console",
    });
    const northwind = { ...settings, display_name: "Northwind" };
    expect(signInHeading(northwind).title).toBe("Northwind");
    expect(signInButtonLabel(northwind)).toBe("Sign in with Northwind SSO");
    expect(TEAM_NOTE).toMatch(/depends on your team/);
  });

  it("titles Tenkai when no organisation sign-in is configured", () => {
    expect(signInHeading(null)).toEqual({ title: "Tenkai", subtitle: "Delivery console" });
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
