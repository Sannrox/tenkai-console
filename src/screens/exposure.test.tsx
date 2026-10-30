// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AdvisoryFeedStatus,
  EffectiveCriticality,
  ExposureQueryResult,
} from "../api/tenkai.gen";
import { useSession } from "../auth/session";
import { Exposure } from "./exposure";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const IMPORTED = Date.UTC(2026, 9, 28, 12);

const FEED: AdvisoryFeedStatus = {
  imported: true,
  imported_at: IMPORTED,
  generated_at: IMPORTED,
  age_ms: 86_400_000,
  advisory_count: 1,
  matches: [
    {
      advisory_id: "TENKAI-2026-1",
      severity: "high",
      component: "openssl",
      component_version: "1.1.1",
      release: "api@1.0.0",
      release_id: "tenkai:release:api@1.0.0",
    },
  ],
};

const RESULT: ExposureQueryResult = {
  component: "openssl",
  range: ">=1.0.0",
  matches: [
    {
      release: "api@1.0.0",
      product: "api",
      version: "1.0.0",
      release_id: "tenkai:release:api@1.0.0",
      component: "openssl",
      component_version: "1.1.1",
      channels: ["api/stable"],
      environments: [
        {
          environment: "hub",
          deployed_release: "api@1.0.0",
          freshness: { kind: "hub" },
          criticality: "high",
        },
        {
          environment: "spoke",
          deployed_release: "api@1.0.0",
          freshness: { kind: "as_of_last_bundle_import", imported_at: IMPORTED },
        },
      ],
      criticality: "high",
    },
  ],
};

const PRODUCT: EffectiveCriticality = {
  derived: {
    level: "high",
    source: "envelope",
    reason: "advisory",
    generated_at: 1,
    imported_at: 1,
    age_ms: 1,
    stale: false,
  },
  effective: "high",
};

type Call = { method: string; path: string; body: unknown };

let root: Root;
let container: HTMLElement;
let calls: Call[];

const serve = (onRecall?: (release: string) => { status?: number; body: unknown }) => {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const path = `${url.pathname.replace(/^\//, "")}${url.search}`;
      const call: Call = {
        method: init?.method ?? "GET",
        path,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      };
      calls.push(call);
      if (call.method === "POST" && path.startsWith("v1/releases/")) {
        const release = decodeURIComponent(
          path.slice("v1/releases/".length).replace(/\/recall$/, ""),
        );
        const reply = onRecall?.(release) ?? {
          body: { version: 1, operation: "recall", message: `recalled ${release}` },
        };
        return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
      }
      const body =
        path === "v1/advisory-feed"
          ? FEED
          : path.startsWith("v1/exposures")
            ? RESULT
            : path.startsWith("v1/products/")
              ? PRODUCT
              : { error: "not found" };
      return new Response(JSON.stringify(body), {
        status:
          path === "v1/advisory-feed" ||
          path.startsWith("v1/exposures") ||
          path.startsWith("v1/products/")
            ? 200
            : 404,
      });
    }),
  );
};

const settle = async () => {
  for (let round = 0; round < 6; round += 1) {
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
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { mutations: { networkMode: "always", retry: false } },
          })
        }
      >
        <Exposure />
      </QueryClientProvider>,
    );
  });
  await settle();
};

const button = (label: string) =>
  [...container.querySelectorAll("button")].find((element) => element.textContent === label);

const click = async (label: string) => {
  await act(async () => {
    button(label)?.click();
  });
  await settle();
};

const type = async (label: string, value: string) => {
  const input = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  await act(async () => {
    // React tracks an input's value; only the native setter lets it see the change.
    // oxlint-disable-next-line typescript/unbound-method -- called with the input as `this`
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

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

describe("Exposure", () => {
  it("shows feed status, queries the same path as the CLI, and lists freshness", async () => {
    serve();
    await render();
    expect(container.textContent).toContain("last import");
    expect(container.textContent).toContain("stale-feed gate: feed present");
    expect(calls.map((call) => call.path)).toContain("v1/advisory-feed");

    await type("Component", "openssl");
    await type("Range", ">=1.0.0");
    await click("Query");
    expect(calls.map((call) => call.path)).toContain(
      "v1/exposures?component=openssl&range=%3E%3D1.0.0",
    );
    expect(container.textContent).toContain("live");
    expect(container.textContent).toContain("spoke");
    expect(container.textContent).toContain("api@1.0.0");
    expect(container.textContent).toContain("1.1.1");
    expect(container.textContent).toContain("high (derived)");
    expect(container.textContent).toContain(`as of bundle ${new Date(IMPORTED).toISOString()}`);
  });

  it("hides propose when the credential already lacks management", async () => {
    useSession.setState({
      refused: [{ scope: "fleet", capability: "management" }],
    });
    serve();
    await render();
    await type("Component", "openssl");
    await type("Range", ">=1.0.0");
    await click("Query");
    expect(button("Propose fix-forward")).toBeUndefined();
    expect(button("Export CSV")).toBeDefined();
  });

  it("recalls matching releases and hides propose after a credential refusal", async () => {
    serve(() => ({
      status: 403,
      body: { error: "insufficient delivery capability" },
    }));
    await render();
    await type("Component", "openssl");
    await type("Range", ">=1.0.0");
    await click("Query");
    expect(button("Propose fix-forward")).toBeDefined();
    await click("Propose fix-forward");
    await click("Recall api@1.0.0");
    expect(calls.find((call) => call.method === "POST")).toMatchObject({
      method: "POST",
      path: "v1/releases/api%401.0.0/recall",
      body: { version: 1, operation: "recall" },
    });
    expect(button("Propose fix-forward")).toBeUndefined();
    expect(container.textContent).toContain("missing management capability");
  });

  it("exports the result table without calling the server", async () => {
    serve();
    const clicks: string[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:exposure");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push(this.download);
    });
    await render();
    await type("Component", "openssl");
    await type("Range", ">=1.0.0");
    await click("Query");
    const before = calls.length;
    await click("Export CSV");
    expect(clicks).toEqual(["exposure-openssl.csv"]);
    expect(calls.length).toBe(before);
    clickSpy.mockRestore();
  });
});
