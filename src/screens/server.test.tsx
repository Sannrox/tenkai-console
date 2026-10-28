// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrustPosture } from "../api/tenkai.gen";
import { useSession } from "../auth/session";
import { Server } from "./server";

// React's act() needs this flag outside a test renderer.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TRUST: TrustPosture = {
  status: "ok",
  warning_days: 30,
  critical_days: 7,
  runtime_client_cert_required: false,
  signing: [],
  tls: [
    {
      purpose: "listener",
      file: "listener certificate in use",
      source: "loaded",
      status: "ok",
      subject: "CN=hub",
    },
    {
      purpose: "runner_ca",
      file: "runner CA in use",
      source: "loaded",
      status: "warning",
      subject: "CN=runner-ca",
      sha256_fingerprint: "C6:32",
    },
  ],
};

/** A fetch stub answering GETs by path. */
const serve = (answer: (path: string) => { status?: number; body: unknown }) => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
      const reply = answer(new URL(url).pathname.replace(/^\//, ""));
      return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
    }),
  );
};

let root: Root;
let container: HTMLElement;

const render = async () => {
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <Server />
      </QueryClientProvider>,
    );
  });
  await settle();
};

/** Let pending requests and renders finish. */
const settle = async () => {
  for (let round = 0; round < 5; round += 1) {
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });
  }
};

const cells = () =>
  [...container.querySelectorAll("tbody tr")].map((row) =>
    [...row.querySelectorAll("th, td")].map((cell) => cell.textContent),
  );

beforeEach(() => {
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

describe("Server", () => {
  it("shows the hub facts and one row per environment, static bearer tokens in warning", async () => {
    serve((path) => {
      if (path === "v1/trust") {
        return { body: TRUST };
      }
      if (path === "v1/environments") {
        return { body: [{ name: "prod" }, { name: "lab" }] };
      }
      return {
        body: {
          runners: [
            { id: "a", environment: "prod", state: "static", auth: "bearer", instances: [] },
            {
              id: "b",
              environment: "prod",
              state: "active",
              auth: "client_certificate",
              instances: [],
            },
          ],
        },
      };
    });
    await render();
    expect(cells()).toStrictEqual([
      ["TLS", "nativeCN=hub"],
      ["Runner mTLS", "optional"],
      ["Runner CA", "CN=runner-caSHA-256 C6:32"],
      ["lab", "0", "0", "0"],
      ["prod", "2", "1", "1"],
    ]);
    const bearer = [...container.querySelectorAll("tbody tr")].at(-1)?.lastElementChild;
    expect(bearer?.className).toContain("text-warning");
    const mtls = [...container.querySelectorAll("tbody tr")][1]?.querySelector("td div");
    expect(mtls?.className).toBe("text-warning");
  });

  it("shows a refused runner registry without hiding the hub facts", async () => {
    serve((path) =>
      path === "v1/runners"
        ? { status: 403, body: { error: "insufficient delivery capability" } }
        : path === "v1/trust"
          ? { body: { ...TRUST, tls: [] } }
          : { body: [] },
    );
    await render();
    expect(cells()).toStrictEqual([
      ["TLS", "proxy or local"],
      ["Runner mTLS", "optional"],
      ["Runner CA", "none"],
      ["insufficient delivery capability"],
    ]);
  });

  it("shows the environment list's error instead of a partial inventory", async () => {
    serve((path) =>
      path === "v1/environments"
        ? { status: 500, body: { error: "environment list unavailable" } }
        : path === "v1/trust"
          ? { body: TRUST }
          : {
              body: { runners: [{ id: "a", environment: "prod", state: "active", instances: [] }] },
            },
    );
    await render();
    expect(cells().slice(3)).toStrictEqual([["environment list unavailable"]]);
  });

  it("shows Loading, not zero counts, until the runner registry answers", async () => {
    serve((path) => (path === "v1/trust" ? { body: TRUST } : { body: [{ name: "prod" }] }));
    let answer: (response: Response) => void = () => {};
    const stub = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const url =
          input instanceof Request ? input.url : input instanceof URL ? input.href : input;
        return url.endsWith("v1/runners")
          ? new Promise<Response>((resolve) => {
              answer = resolve;
            })
          : stub(input, init);
      }),
    );
    await render();
    expect(cells().slice(3)).toStrictEqual([["Loading"]]);

    await act(async () => {
      answer(new Response(JSON.stringify({ runners: [] })));
    });
    await settle();
    expect(cells().slice(3)).toStrictEqual([["prod", "0", "0", "0"]]);
  });

  it("refetches every list on Refresh", async () => {
    const paths: string[] = [];
    serve((path) => {
      paths.push(path);
      return path === "v1/trust"
        ? { body: TRUST }
        : path === "v1/runners"
          ? { body: { runners: [] } }
          : { body: [] };
    });
    await render();
    paths.length = 0;
    const refresh = [...container.querySelectorAll("button")].find(
      (element) => element.textContent === "Refresh",
    );
    await act(async () => {
      refresh?.click();
    });
    await settle();
    expect(paths.toSorted()).toStrictEqual(["v1/environments", "v1/runners", "v1/trust"]);
  });

  it("lists both runner CAs during rotation, the expiring one first in danger", async () => {
    const rotating: TrustPosture = {
      ...TRUST,
      tls: [
        {
          purpose: "runner_ca",
          file: "runner CA in use",
          source: "loaded",
          status: "ok",
          subject: "CN=new",
        },
        {
          purpose: "runner_ca",
          file: "runner CA in use",
          source: "loaded",
          status: "critical",
          subject: "CN=old",
          days_left: 3,
        },
      ],
    };
    serve((path) =>
      path === "v1/trust"
        ? { body: rotating }
        : path === "v1/runners"
          ? { body: { runners: [] } }
          : { body: [] },
    );
    await render();
    const lines = [...(container.querySelector("tbody tr:nth-child(3) td")?.children ?? [])];
    expect(lines.map((line) => [line.textContent, line.className])).toStrictEqual([
      ["CN=old", "text-danger"],
      ["CN=new", ""],
    ]);
  });

  it("keeps the last data after a failed refresh and says when it is from", async () => {
    let failing = false;
    serve((path) =>
      failing && path === "v1/trust"
        ? { status: 503, body: { error: "trust posture unavailable" } }
        : path === "v1/trust"
          ? { body: TRUST }
          : path === "v1/runners"
            ? { body: { runners: [] } }
            : { body: [{ name: "prod" }] },
    );
    await render();
    failing = true;
    const refresh = [...container.querySelectorAll("button")].find(
      (element) => element.textContent === "Refresh",
    );
    await act(async () => {
      refresh?.click();
    });
    await settle();
    const alert = container.querySelector('[role="alert"]')?.textContent ?? "";
    expect(alert).toMatch(
      /^Refresh failed: trust posture unavailable\. Showing data from \d{4}-\d\d-\d\dT.+Z\.$/,
    );
    expect(cells()[0]).toStrictEqual(["TLS", "nativeCN=hub"]);
    expect(cells().at(-1)).toStrictEqual(["prod", "0", "0", "0"]);
  });

  it("shows what a server before tenkai#809 omits as not reported, never as bearer", async () => {
    const { runtime_client_cert_required: _omitted, ...older } = TRUST;
    serve((path) =>
      path === "v1/trust"
        ? { body: older }
        : path === "v1/runners"
          ? {
              body: { runners: [{ id: "a", environment: "prod", state: "active", instances: [] }] },
            }
          : { body: [{ name: "prod" }] },
    );
    await render();
    expect(cells()[1]).toStrictEqual(["Runner mTLS", "not reported"]);
    expect(cells().at(-1)).toStrictEqual(["prod", "1", "0", "0", "1"]);
    expect(container.querySelector("thead")?.textContent).toContain("Auth not reported");
  });
});
