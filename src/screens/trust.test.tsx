// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanRunways, TrustPosture } from "../api/tenkai.gen";
import { useSession } from "../auth/session";
import { Trust } from "./trust";

// React's act() needs this flag outside a test renderer.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TRUST: TrustPosture = {
  status: "critical",
  warning_days: 30,
  critical_days: 7,
  runtime_client_cert_required: true,
  signing: [
    {
      purpose: "release",
      file: "release.toml",
      source: "file",
      signer_validity: "not_recorded",
      signers: [{ key_id: "k1", identity: "release-bot", revoked: true }],
    },
  ],
  revocation_list: {
    file: "revocations.json",
    sequence: 4,
    signer_key_id: "authority",
    issued_at: Date.UTC(2026, 9, 1),
    installed_at: Date.UTC(2026, 9, 2),
    revoked_keys: 1,
  },
  tls: [
    {
      purpose: "listener",
      file: "listener certificate in use",
      source: "loaded",
      status: "ok",
      subject: "CN=hub",
      not_after: Date.UTC(2027, 5, 1) / 1_000,
      days_left: 200,
    },
    {
      purpose: "runner_ca",
      file: "runner CA in use",
      source: "loaded",
      status: "critical",
      subject: "CN=runner-ca",
      not_after: Date.UTC(2026, 10, 1) / 1_000,
      days_left: 3,
    },
  ],
};

let root: Root;
let container: HTMLElement;

const settle = async () => {
  for (let round = 0; round < 5; round += 1) {
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });
  }
};

const render = async () => {
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <Trust />
      </QueryClientProvider>,
    );
  });
  await settle();
};

const rows = (index: number) =>
  [...(container.querySelectorAll("table")[index]?.querySelectorAll("tbody tr") ?? [])].map((row) =>
    [...row.querySelectorAll("td")].map((cell) => cell.textContent),
  );

const BLOCKED: PlanRunways = {
  plans: [
    { plan_id: "plan-lab", environment: "lab", plan_state: "computed" },
    {
      plan_id: "plan-prod",
      environment: "prod",
      plan_state: "computed",
      window_opens_at_ms: Date.UTC(2026, 10, 5),
      blocked_by: {
        credential: "runner_ca (CN=runner-ca)",
        expires_at_ms: Date.UTC(2026, 10, 1),
        window_opens_at_ms: Date.UTC(2026, 10, 5),
      },
    },
  ],
};

/** Answer `/v1/trust` and `/v1/trust/runway`; a `Response` is sent as is. */
const serve = (trust: unknown, runway: unknown) => {
  const reply = (body: unknown) =>
    body instanceof Response ? body.clone() : new Response(JSON.stringify(body));
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
      return reply(url.endsWith("v1/trust/runway") ? runway : trust);
    }),
  );
};

const runwayBanner = () => container.querySelector('[aria-label="Credential runway"]');

beforeEach(() => {
  serve(TRUST, BLOCKED);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  useSession.setState({
    session: {
      kind: "token",
      accessToken: "operator",
      subject: undefined,
      expiresAt: undefined,
      refreshToken: undefined,
      idToken: undefined,
    },
    refused: [],
  });
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
});

describe("Trust", () => {
  it("names the first blocked plan, lists signers and certificates, and the revocation list", async () => {
    await render();
    expect(runwayBanner()?.textContent).toBe(
      "Plan plan-prod for prod waits for the window opening 2026-11-05T00:00:00.000Z, but runner_ca (CN=runner-ca) expires 2026-11-01T00:00:00.000Z.",
    );
    expect(runwayBanner()?.className).toContain("text-danger");
    expect(rows(0)).toStrictEqual([["release", "release-bot", "k1", "on disk", "revoked"]]);
    expect(container.querySelector("table tbody td:nth-child(4)")?.className).toContain(
      "text-muted",
    );
    expect(container.textContent).not.toContain("restart");
    expect(container.textContent).toContain("Signer validity is not recorded in trust roots.");
    expect(rows(1)).toStrictEqual([
      ["runner_ca", "CN=runner-ca, until 2026-11-01 (3 days)", "critical"],
      ["listener", "CN=hub, until 2027-06-01 (200 days)", "ok"],
    ]);
    expect(
      container.querySelectorAll("table")[1]?.querySelector("tbody td:last-child")?.className,
    ).toContain("text-danger");
    expect(container.querySelector('[aria-label="Revocation list"]')?.textContent).toBe(
      "Revocation list sequence 4, 1 revoked keys, signed by authority, issued 2026-10-01T00:00:00.000Z, file written 2026-10-02T00:00:00.000Z",
    );
  });

  it("shows no banner when nothing is blocked, and the restart line only for a loaded root", async () => {
    const loaded = {
      purpose: "package_migration_approval",
      file: "package migration trust roots in use",
      source: "loaded",
      signers: [{ key_id: "k2", identity: "approver", revoked: false }],
    };
    serve({ ...TRUST, signing: [...TRUST.signing, loaded] }, { plans: [BLOCKED.plans[0]] });
    await render();
    expect(runwayBanner()).toBeNull();
    expect(container.querySelector('[aria-label="Runway"]')).toBeNull();
    const restart = [...container.querySelectorAll("p")].filter((line) =>
      line.textContent?.includes("restart"),
    );
    expect(restart.map((line) => line.textContent)).toStrictEqual([
      "package_migration_approval (package migration trust roots in use): Loaded at startup; changes apply after a restart.",
    ]);
  });

  it("omits the validity line when roots do not report it as not recorded", async () => {
    serve({ ...TRUST, signing: [{ ...TRUST.signing[0], signer_validity: undefined }] }, BLOCKED);
    await render();
    expect(container.textContent).not.toContain("Signer validity is not recorded");
  });

  it("shows Loading, then the runway's error, and keeps data after a failed refresh", async () => {
    // Requests that never answer: both stay loading.
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => new Promise<Response>(() => {})),
    );
    await render();
    expect(container.querySelector('[aria-label="Runway"]')?.textContent).toBe("Runway: Loading");
    expect(container.querySelector("table")).toBeNull();

    // A fresh mount: the runway fails, the posture still shows.
    await act(async () => {
      root.unmount();
    });
    root = createRoot(container);
    serve(
      TRUST,
      new Response(JSON.stringify({ error: "not available in tenant mode" }), { status: 503 }),
    );
    await render();
    const refresh = () =>
      [...container.querySelectorAll("button")].find(
        (element) => element.textContent === "Refresh",
      );
    expect(container.querySelector('[aria-label="Runway"]')?.textContent).toBe(
      "Runway: not available in tenant mode",
    );

    serve(TRUST, BLOCKED);
    await act(async () => {
      refresh()?.click();
    });
    await settle();
    expect(runwayBanner()).not.toBeNull();
    serve(
      new Response(JSON.stringify({ error: "trust posture unavailable" }), { status: 503 }),
      new Response(JSON.stringify({ error: "runway unavailable" }), { status: 503 }),
    );
    await act(async () => {
      refresh()?.click();
    });
    await settle();
    expect(
      [...container.querySelectorAll('[role="alert"]')].map((line) =>
        line.textContent?.replace(/ Showing data from .*$/, ""),
      ),
    ).toStrictEqual([
      "Refresh failed: trust posture unavailable.",
      "Refresh failed: runway unavailable.",
    ]);
    expect(runwayBanner()).not.toBeNull();
    expect(rows(0)).toStrictEqual([["release", "release-bot", "k1", "on disk", "revoked"]]);
  });

  it("shows a root with no signers as a warning row, and the empty notice only without roots", async () => {
    const empty = { purpose: "bundle_import", file: "bundles.toml", source: "file", signers: [] };
    serve({ ...TRUST, signing: [empty] }, BLOCKED);
    await render();
    expect(rows(0)).toStrictEqual([["bundle_import", "", "", "on disk", "no signers"]]);
    expect(container.querySelector("table tbody td:last-child")?.className).toContain(
      "text-warning",
    );
    expect(container.textContent).not.toContain("No trust roots configured");

    await act(async () => {
      root.unmount();
    });
    root = createRoot(container);
    serve({ ...TRUST, signing: [] }, BLOCKED);
    await render();
    expect(rows(0)).toStrictEqual([["No trust roots configured"]]);
  });
});
