// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrustPosture } from "../api/tenkai.gen";
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
      signers: [{ key_id: "k1", identity: "release-bot", revoked: true }],
    },
  ],
  revocation_list: {
    file: "revocations.json",
    sequence: 4,
    signer_key_id: "authority",
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

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async () => new Response(JSON.stringify(TRUST))),
  );
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
  it("names the first expiry, lists signers and certificates by expiry, and the revocation list", async () => {
    await render();
    expect(container.textContent).toContain(
      "Credential runway: runner_ca CN=runner-ca, until 2026-11-01 (3 days)",
    );
    expect(container.textContent).toContain("Which scheduled plan it blocks is not reported");
    expect(rows(0)).toStrictEqual([["release", "release-bot", "k1", "on disk", "revoked"]]);
    const source = container.querySelector("table tbody td:nth-child(4)");
    expect(source?.className).toContain("text-muted");
    expect(container.textContent).toContain(
      "release (release.toml): As on disk now. The server adopts changes after a restart.",
    );
    expect(rows(1)).toStrictEqual([
      ["runner_ca", "CN=runner-ca, until 2026-11-01 (3 days)", "critical"],
      ["listener", "CN=hub, until 2027-06-01 (200 days)", "ok"],
    ]);
    const critical = container.querySelectorAll("table")[1]?.querySelector("tbody td:last-child");
    expect(critical?.className).toContain("text-danger");
    expect(container.querySelector('[aria-label="Revocation list"]')?.textContent).toBe(
      "Revocation list sequence 4, 1 revoked keys, signed by authority. Import time not reported.",
    );
  });

  it("shows Loading before the first answer and keeps data after a failed refresh", async () => {
    let answer: (response: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(
        async () =>
          new Promise<Response>((resolve) => {
            answer = resolve;
          }),
      ),
    );
    await render();
    expect(container.textContent).toContain("Loading");
    expect(container.querySelector("table")).toBeNull();
    await act(async () => {
      answer(new Response(JSON.stringify({ ...TRUST, tls: [] })));
    });
    await settle();
    expect(container.textContent).toContain("every certificate is beyond its warning threshold");

    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(
        async () =>
          new Response(JSON.stringify({ error: "trust posture unavailable" }), { status: 503 }),
      ),
    );
    const refresh = [...container.querySelectorAll("button")].find(
      (element) => element.textContent === "Refresh",
    );
    await act(async () => {
      refresh?.click();
    });
    await settle();
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(
      /^Refresh failed: trust posture unavailable\. Showing data from /,
    );
    expect(rows(0)).toStrictEqual([["release", "release-bot", "k1", "on disk", "revoked"]]);
  });

  it("shows a root with no signers as a warning row, and the empty notice only without roots", async () => {
    const empty = { purpose: "bundle_import", file: "bundles.toml", source: "file", signers: [] };
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ ...TRUST, signing: [empty] }))),
    );
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
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ ...TRUST, signing: [] }))),
    );
    await render();
    expect(rows(0)).toStrictEqual([["No trust roots configured"]]);
  });
});
