// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelPage, ChangeEventPage, FleetStatusReport } from "../api/tenkai.gen";
import { useSession } from "../auth/session";
import { Releases } from "./releases";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("./compatibility", () => ({ Compatibility: () => null }));
vi.mock("./migrations", () => ({ Migrations: () => null }));

const FLEET: FleetStatusReport = {
  environment_count: 2,
  environments_behind: 1,
  environments_current: 1,
  environments_empty: 0,
  environments_unhealthy: 0,
  environments: [
    {
      name: "canary",
      id: "tenkai:environment:canary",
      description: "",
      subscription_count: 1,
      products_current: 1,
      products_behind: 0,
      products_missing: 0,
      unhealthy: false,
      health_summary: "ok",
      lease_held: false,
      posture: "current",
    },
    {
      name: "prod",
      id: "tenkai:environment:prod",
      description: "",
      subscription_count: 1,
      products_current: 0,
      products_behind: 1,
      products_missing: 0,
      unhealthy: false,
      health_summary: "ok",
      lease_held: false,
      posture: "behind",
    },
  ],
};

const CHANNELS: ChannelPage = { items: [] };

const EVENTS: ChangeEventPage = {
  next_cursor: "3",
  events: [
    {
      cursor: "1",
      occurred_at: Date.UTC(2026, 9, 28),
      kind: "release_published",
      resource: "api@1.0.0",
    },
    {
      cursor: "2",
      occurred_at: Date.UTC(2026, 9, 29),
      kind: "release_recalled",
      resource: "api@1.0.0",
    },
  ],
};

type Call = { method: string; path: string; body: unknown };

let root: Root;
let container: HTMLElement;
let calls: Call[];

const serve = () => {
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
      if (call.method === "POST" && path.endsWith("/hold")) {
        return new Response(JSON.stringify({ version: 1, operation: "hold", message: "held" }));
      }
      if (call.method === "POST") {
        return new Response(
          JSON.stringify({ version: 1, operation: "recall", message: "recalled" }),
        );
      }
      const body =
        path === "v1/fleet/status"
          ? FLEET
          : path === "v1/environments"
            ? FLEET.environments.map((row) => ({
                name: row.name,
                id: row.id,
                description: row.description,
                subscription_count: row.subscription_count,
                deployed_product_count: 1,
                lease_held: false,
                delivery_held: false,
              }))
            : path.startsWith("v1/channels")
              ? CHANNELS
              : path.startsWith("v1/events")
                ? EVENTS
                : path.startsWith("v1/environments/canary")
                  ? {
                      name: "canary",
                      id: "tenkai:environment:canary",
                      description: "",
                      subscriptions: [],
                      facts: {},
                      lease: { held: false, status: "free" },
                      execution_note: "",
                    }
                  : { error: "not found" };
      return new Response(JSON.stringify(body), {
        status: "error" in (body as object) ? 404 : 200,
      });
    }),
  );
};

const settle = async () => {
  for (let round = 0; round < 8; round += 1) {
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
        <Releases />
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

describe("Releases recall follow-through", () => {
  it("lists recalled releases and Stop shows the server hold state", async () => {
    serve();
    await render();
    expect(container.textContent).toContain("api@1.0.0");
    expect(container.textContent).toContain("Recall follow-through");
    await type("Cohort", "canary,prod");
    expect(container.querySelector("table[aria-label='Recall cohort']")?.textContent).toContain(
      "canary",
    );
    expect(container.querySelector("table[aria-label='Recall cohort']")?.textContent).toContain(
      "current",
    );
    expect(container.querySelector("table[aria-label='Recall cohort']")?.textContent).toContain(
      "behind",
    );
    await click("Stop");
    await click("Stop canary");
    expect(
      calls.find((call) => call.method === "POST" && call.path.endsWith("/hold")),
    ).toMatchObject({
      method: "POST",
      path: "v1/environments/canary/hold",
      body: {
        version: 1,
        operation: "hold",
        environment: "canary",
        expected_generation: 0,
        reason: "recall follow-through",
      },
    });
  });

  it("hides Stop and Resume for a credential without management", async () => {
    useSession.setState({
      refused: [{ scope: "fleet", capability: "management" }],
    });
    serve();
    await render();
    await type("Cohort", "canary,prod");
    expect(container.querySelector("table[aria-label='Recall cohort']")?.textContent).toContain(
      "canary",
    );
    expect(button("Stop")).toBeUndefined();
    expect(button("Resume")).toBeUndefined();
  });
});
