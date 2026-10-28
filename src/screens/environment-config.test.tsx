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

  it("edits one webhook by URL with its existing events, and never clears them all", async () => {
    serve(() => ok);
    const report = {
      ...REPORT,
      webhooks: [
        {
          url: "https://hooks.example/deploy",
          secret_env: "DEPLOY_SECRET",
          events: ["apply.failed"],
          operational: ["plan.held"],
        },
        { url: "https://hooks.example/audit", secret_env: "AUDIT_SECRET" },
      ],
    } as EnvironmentInspectReport;
    await render(<ConfigSections report={report} token="operator" />);
    expect(container.querySelector('[aria-label="Webhooks configured"]')?.textContent).toBe(
      "https://hooks.example/deploy (DEPLOY_SECRET) apply.failed,plan.held · https://hooks.example/audit (AUDIT_SECRET) apply.succeeded,apply.failed,apply.rolled_back",
    );
    await click("Edit", 3);
    await click("https://hooks.example/deploy");
    await type("Secret variable", "DEPLOY_SECRET_V2");
    await type("Reason", "rotate secret");
    await click("Save");
    await click("Save webhook https://hooks.example/deploy");
    expect(calls[0]).toStrictEqual({
      method: "PUT",
      path: "v1/environments/prod/webhooks",
      body: {
        version: 1,
        operation: "configure",
        environment: "prod",
        expected_generation: 7,
        reason: "rotate secret",
        change: {
          kind: "set_webhook",
          url: "https://hooks.example/deploy",
          secret_env: "DEPLOY_SECRET_V2",
          events: ["apply.failed"],
          operational: ["plan.held"],
        },
      },
    });
    await click("Remove");
    await click("Remove webhook https://hooks.example/deploy");
    expect(calls[1]).toMatchObject({
      method: "DELETE",
      path: "v1/environments/prod/webhooks",
      body: { change: { kind: "clear_webhooks", url: "https://hooks.example/deploy" } },
    });
  });

  it("shows the policy path and sets or clears it", async () => {
    serve(() => ok);
    const report = {
      ...REPORT,
      approval_policy: "/etc/tenkai/prod-policy.toml",
    } as EnvironmentInspectReport;
    await render(<ConfigSections report={report} token="operator" />);
    expect(container.querySelector('[aria-label="Approval policy configured"]')?.textContent).toBe(
      "/etc/tenkai/prod-policy.toml",
    );
    await click("Edit", 4);
    await type("Policy file path", "/etc/tenkai/prod-policy-v2.toml");
    await type("Reason", "new quorum");
    await click("Set");
    await click("Set policy /etc/tenkai/prod-policy-v2.toml");
    await click("Clear");
    await click("Clear the approval policy");
    expect(calls.map((call) => [call.method, call.path, call.body])).toStrictEqual([
      [
        "PUT",
        "v1/environments/prod/approval-policy",
        expect.objectContaining({
          change: { kind: "set_approval_policy", path: "/etc/tenkai/prod-policy-v2.toml" },
        }),
      ],
      [
        "DELETE",
        "v1/environments/prod/approval-policy",
        expect.objectContaining({ change: { kind: "clear_approval_policy" } }),
      ],
    ]);
  });

  it("shows an empty subscription as every outcome and never sends an empty list", async () => {
    serve(() => ok);
    const report = {
      ...REPORT,
      webhooks: [{ url: "https://hooks.example/audit", secret_env: "AUDIT_SECRET" }],
    } as EnvironmentInspectReport;
    await render(<ConfigSections report={report} token="operator" />);
    await click("Edit", 3);
    await click("https://hooks.example/audit");
    const boxes = () => [
      ...container.querySelectorAll<HTMLInputElement>('[aria-label="Events"] input'),
    ];
    // The server sends every apply outcome to it: all three show checked.
    expect(
      boxes()
        .slice(0, 3)
        .map((box) => box.checked),
    ).toStrictEqual([true, true, true]);
    await type("Reason", "narrow");
    // Unchecking every box blocks Save instead of sending `events: []`.
    for (const box of boxes().slice(0, 3)) {
      await act(async () => {
        box.click();
      });
    }
    expect(container.textContent).toContain("Choose at least one outcome");
    expect(buttons("Save")[0]?.disabled).toBe(true);
    // One outcome left is sent explicitly.
    await act(async () => {
      boxes()[1]?.click();
    });
    expect(container.textContent).not.toContain("Choose at least one outcome");
    await click("Save");
    await click("Save webhook https://hooks.example/audit");
    expect(calls[0]?.body).toMatchObject({
      change: { kind: "set_webhook", events: ["apply.failed"], operational: [] },
    });
  });

  it("sends the generation a draft was loaded at, so a refresh cannot hide a newer change", async () => {
    serve(() => ok);
    const hook = { url: "https://hooks.example/deploy", secret_env: "DEPLOY_SECRET" };
    const at = (generation: number) =>
      ({
        ...REPORT,
        lease: { held: true, generation },
        webhooks: [hook],
      }) as EnvironmentInspectReport;
    const client = new QueryClient({ defaultOptions: { mutations: { networkMode: "always" } } });
    const show = async (report: EnvironmentInspectReport) => {
      await act(async () => {
        root.render(
          <QueryClientProvider client={client}>
            <ConfigSections report={report} token="operator" />
          </QueryClientProvider>,
        );
      });
      await settle();
    };
    await show(at(7));
    await click("Edit", 0);
    // Facts is open, so its Edit reads Close: Webhooks is now the third Edit.
    await click("Edit", 2);
    await click("https://hooks.example/deploy");
    // Another operator's change lands; the report refreshes to generation 8.
    await show(at(8));
    const reasons = container.querySelectorAll<HTMLInputElement>('input[aria-label="Reason"]');
    expect(reasons).toHaveLength(2);
    await act(async () => {
      // oxlint-disable-next-line typescript/unbound-method -- called with the input as `this`
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      for (const input of reasons) {
        setter?.call(input, "stale draft");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    await click("Save");
    await click("Save webhook https://hooks.example/deploy");
    await type("Fact key", "architecture");
    await type("Fact value", "arm64");
    await click("Set");
    await click("Set architecture=arm64");
    expect(
      calls.map((call) => (call.body as { expected_generation: number }).expected_generation),
    ).toStrictEqual([7, 7]);
  });
});
