// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnvironmentInspectReport } from "../api/tenkai.gen";
import { useSession } from "../auth/session";
import { AddEnvironment, ConfigSections } from "./environment-config";

// React's act() needs this flag outside a test renderer.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const REPORT = {
  name: "prod",
  id: "prod",
  description: "",
  execution_note: "",
  facts: {},
  subscriptions: [],
  lease: { held: true, generation: 7 },
} as unknown as EnvironmentInspectReport;

type Call = { method: string; path: string; body: unknown };
let calls: Call[];
let root: Root;
let container: HTMLElement;

const serve = (reply: (call: Call) => { status?: number; body: unknown }) => {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const call = {
        method: init?.method ?? "GET",
        path: url.pathname.replace(/^\//, ""),
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      };
      calls.push(call);
      const answer = reply(call);
      return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
    }),
  );
};

const settle = async () => {
  for (let round = 0; round < 5; round += 1) {
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });
  }
};

const render = async (ui: ReactNode) => {
  await act(async () => {
    root.render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { mutations: { networkMode: "always" } } })}
      >
        {ui}
      </QueryClientProvider>,
    );
  });
  await settle();
};

const buttons = (label: string) =>
  [...container.querySelectorAll("button")].filter((element) => element.textContent === label);

const click = async (label: string, index = 0) => {
  const target = buttons(label)[index];
  expect(target, `button ${label}`).toBeDefined();
  await act(async () => {
    target?.click();
  });
  await settle();
};

const type = async (label: string, value: string) => {
  const input = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  expect(input, `input ${label}`).not.toBeNull();
  await act(async () => {
    // React tracks an input's value; only the native setter lets it see the change.
    // oxlint-disable-next-line typescript/unbound-method -- called with the input as `this`
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

const ok = { body: { version: 1, operation: "configure", message: "fact set" } };

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

describe("environment configuration", () => {
  it("sets a fact in one request with the reason and the shown generation", async () => {
    serve(() => ok);
    await render(<ConfigSections report={REPORT} token="operator" />);
    await click("Edit", 0);
    await type("Fact key", "architecture");
    await type("Fact value", "arm64");
    await type("Reason", "inventory");
    await click("Set");
    expect(calls).toStrictEqual([]);
    await click("Set architecture=arm64");
    expect(calls).toStrictEqual([
      {
        method: "PUT",
        path: "v1/environments/prod/facts",
        body: {
          version: 1,
          operation: "configure",
          environment: "prod",
          expected_generation: 7,
          reason: "inventory",
          change: { kind: "set_fact", key: "architecture", value: "arm64" },
        },
      },
    ]);
    expect(container.textContent).toContain("fact set");
  });

  it("shows a refusal inline and hides every Edit once the credential is refused", async () => {
    serve(() => ({ status: 403, body: { error: "insufficient delivery capability" } }));
    await render(<ConfigSections report={REPORT} token="operator" />);
    await click("Edit", 1);
    await type("Product", "app");
    await type("Reason", "freeze");
    await click("Clear");
    await click("Clear version_pin app");
    expect(calls[0]).toMatchObject({ method: "DELETE", path: "v1/environments/prod/constraints" });
    expect(container.textContent).toContain("missing management capability");
    expect(buttons("Edit")).toStrictEqual([]);
  });

  it("previews the next window and saves it with the chosen weekdays", async () => {
    serve(() => ok);
    await render(<ConfigSections report={REPORT} token="operator" />);
    await click("Edit", 2);
    await type("Window name", "weekly");
    await type("Time zone", "UTC");
    expect(container.querySelector('[aria-label="Next window"]')?.textContent).toBe(
      "No preview: pick weekdays",
    );
    const thursday = container.querySelectorAll<HTMLInputElement>(
      '[aria-label="Weekdays"] input',
    )[3];
    await act(async () => {
      thursday?.click();
    });
    expect(container.querySelector('[aria-label="Next window"]')?.textContent).toMatch(
      /^Next opens \w{3} \d{2}:\d{2} your time$/,
    );
    // A non-numeric duration is a message, not a crash, and blocks Save.
    await type("Minutes", "abc");
    expect(container.querySelector('[aria-label="Next window"]')?.textContent).toBe(
      "No preview: minutes must be a whole number above 0",
    );
    await type("Minutes", "60");
    await type("Reason", "patch night");
    await click("Save");
    await click("Save window weekly");
    expect(calls[0]).toMatchObject({
      method: "PUT",
      path: "v1/environments/prod/maintenance-windows/weekly",
      body: {
        change: {
          kind: "set_maintenance_window",
          name: "weekly",
          timezone: "UTC",
          weekdays: [4],
          start: "02:00",
          duration_minutes: 60,
        },
      },
    });
  });

  it("adds an environment with a reason", async () => {
    serve(() => ({
      body: { version: 1, operation: "register", message: "environment edge added" },
    }));
    await render(<AddEnvironment token="operator" />);
    await click("Add environment");
    await type("Environment name", "edge");
    await type("Reason", "new site");
    await click("Add");
    await click("Add edge");
    expect(calls).toStrictEqual([
      {
        method: "POST",
        path: "v1/environments",
        body: {
          version: 1,
          operation: "register",
          environment: "edge",
          description: "",
          reason: "new site",
        },
      },
    ]);
    expect(container.textContent).toContain("environment edge added");
  });
});
