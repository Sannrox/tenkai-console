// Sign-in modes against a mocked API (#108): host account over SSH, token, and
// OIDC. Run with `pnpm build && pnpm e2e`.
import { expect, test } from "@playwright/test";
import type { FleetStatusReport, OidcClientDiscovery } from "../src/api/tenkai.gen";
import {
  type MockBackend,
  type Reply,
  type Routes,
  expectDesignRules,
  serveConsole,
} from "./mock-backend";

const FLEET: FleetStatusReport = {
  environments: [
    {
      id: "env:staging",
      name: "staging",
      description: "fixture",
      subscription_count: 1,
      products_current: 1,
      products_behind: 0,
      products_missing: 0,
      unhealthy: false,
      health_summary: "ok",
      lease_held: false,
      posture: "current",
    },
  ],
  environment_count: 1,
  environments_current: 1,
  environments_behind: 0,
  environments_unhealthy: 0,
  environments_empty: 0,
};

const OIDC: OidcClientDiscovery = {
  issuer: "https://idp.example.test/realms/ops",
  audience: "tenkai",
  client_id: "tenkai-console",
  scopes: ["openid", "groups"],
  display_name: "Northwind",
};

/** What `GET /v1/auth/me` reports over a forwarded socket (Tenkai ADR 0047). */
const HOST_ME = {
  principal: "host:uid:1000",
  kind: "human",
  capabilities: ["read", "publish", "management"],
  user: "alice",
  groups: ["tenkai-viewer", "tenkai-operator"],
  source: "host",
};

const TOKEN_ME = { principal: "management", kind: "management", capabilities: ["read"] };

const ok = (body: unknown): Reply => ({ status: 200, body });
const missing: Reply = { status: 401, body: { error: "missing credential" } };

/**
 * A server where `host` decides whether a request without a bearer is a host
 * account (the SSH forward) and `oidc` whether organisation sign-in exists.
 */
const server =
  ({ host, oidc }: { host: boolean; oidc: boolean }): Routes =>
  (path, request) => {
    const bearer = request.headers.authorization;
    if (path === "/v1/auth/oidc") {
      return oidc ? ok(OIDC) : { status: 404, body: { error: "no oidc client" } };
    }
    if (!bearer && !host && path !== "/healthz") {
      return missing;
    }
    if (path === "/v1/auth/me") {
      return ok(bearer ? TOKEN_ME : HOST_ME);
    }
    if (path === "/v1/fleet/status") {
      return ok(FLEET);
    }
    if (path === "/v1/environments" || path === "/v1/channels") {
      return ok(path === "/v1/channels" ? { items: [] } : []);
    }
    return undefined;
  };

// Signed-in screens run at desktop width only: the top bar's tabs do not fit a
// phone yet, independent of sign-in.
test.describe("signed in", () => {
  let app: MockBackend;
  test.afterEach(async () => {
    await app.close();
  });

  test("a host account over SSH is signed in with its groups and grants", async ({ page }) => {
    app = await serveConsole(server({ host: true, oidc: false }));
    await page.goto(app.url);
    await expect(page.getByRole("heading", { name: "Delivery" })).toBeVisible();
    await expectDesignRules(page);

    await page.getByRole("button", { name: /alice/ }).click();
    await expect(page.getByText("host account over SSH")).toBeVisible();
    await expect(page.getByText("Close the SSH tunnel to sign out.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);

    await page.getByRole("link", { name: "Access" }).click();
    const access = page.locator("dl");
    await expect(access).toContainText("alice");
    await expect(access).toContainText("tenkai-viewer, tenkai-operator");
    await expect(access).toContainText("read, publish, management");
    await expectDesignRules(page);
    // The browser holds no credential: the forwarded socket is the sign-in.
    expect(app.sent.filter((sent) => sent.authorization !== undefined)).toEqual([]);
  });

  test("a token session shows its grants and no groups", async ({ page }) => {
    app = await serveConsole(server({ host: false, oidc: false }));
    await page.goto(app.url);
    await page.getByLabel("Platform token").fill("fixture-token");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("link", { name: "Access" }).click();
    const access = page.locator("dl");
    await expect(access).toContainText("bearer token");
    await expect(access).toContainText(/grants\s*read$/);
    await expect(access).not.toContainText("groups");
    await expectDesignRules(page);
  });
});

for (const viewport of [
  { name: "desktop", width: 1280, height: 800 },
  { name: "phone", width: 390, height: 844 },
]) {
  test.describe(`sign-in at ${viewport.name} width`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });
    let app: MockBackend;
    test.afterEach(async () => {
      await app.close();
    });

    test("without OIDC or a host account, it shows the SSH forward and a token", async ({
      page,
    }) => {
      app = await serveConsole(server({ host: false, oidc: false }));
      await page.goto(app.url);
      await expect(page.getByText("ssh -L 8080:/run/tenkai/tenkai.sock <server>")).toBeVisible();
      await expect(page.getByLabel("Platform token")).toBeVisible();
      await page.getByRole("button", { name: "Check again" }).click();
      await expect(page.getByRole("alert")).toHaveText(
        "This connection is not a host account with Tenkai access.",
      );
      await expectDesignRules(page);
    });

    test("with OIDC, it offers the organisation as today", async ({ page }) => {
      app = await serveConsole(server({ host: false, oidc: true }));
      await page.goto(app.url);
      await expect(page.getByRole("button", { name: "Sign in with Northwind SSO" })).toBeVisible();
      await expect(page.getByText("Host account")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Use a token instead" })).toBeVisible();
      await expectDesignRules(page);
    });
  });
}
