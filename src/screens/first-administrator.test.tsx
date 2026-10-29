// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FirstAdministratorBanner } from "./first-administrator";

// React's act() needs this flag outside a test renderer.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Call = { method: string; path: string; authorization: string | null; body: unknown };
let calls: Call[];
let firstAdministrator: "missing" | "configured";
let root: Root;
let container: HTMLElement;
let client: QueryClient;

const FIXTURE = "bg";

const serve = (onPost: () => { status: number; body: unknown }) => {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const headers = new Headers(init?.headers);
      const call = {
        method: init?.method ?? "GET",
        path: url.pathname.replace(/^\//, ""),
        authorization: headers.get("authorization"),
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      };
      calls.push(call);
      if (call.path === "healthz") {
        return new Response(
          JSON.stringify({ status: "ok", first_administrator: firstAdministrator }),
        );
      }
      if (call.method === "POST") {
        const reply = onPost();
        if (reply.status < 300) {
          firstAdministrator = "configured";
        }
        return new Response(JSON.stringify(reply.body), { status: reply.status });
      }
      return new Response(JSON.stringify({ generation: 3, rules: [] }));
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
  client = new QueryClient();
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <FirstAdministratorBanner />
      </QueryClientProvider>,
    );
  });
  await settle();
};

const button = (label: string) =>
  [...container.querySelectorAll("button")].find((element) => element.textContent === label);

const input = (label: string) =>
  container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);

const type = async (label: string, value: string) => {
  const target = input(label);
  await act(async () => {
    // React tracks an input's value; only the native setter lets it see the change.
    // oxlint-disable-next-line typescript/unbound-method -- called with the input as `this`
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(target, value);
    target?.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

const fillAndSubmit = async (value: string) => {
  await act(async () => {
    button("Set up")?.click();
  });
  await type("Group", value);
  await type("Reason", "Initial administrator group");
  await type("Management token", FIXTURE);
  await act(async () => {
    button("Create grant")?.click();
  });
  await settle();
};

beforeEach(() => {
  firstAdministrator = "missing";
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
});

describe("FirstAdministratorBanner", () => {
  it("creates the grant with the token for that request only, then clears the banner", async () => {
    serve(() => ({ status: 201, body: { generation: 4, rules: [] } }));
    await render();
    expect(container.textContent).toContain("No first administrator");
    await fillAndSubmit("tenkai-admins");
    const grantCalls = calls.filter((call) => call.path === "v1/grant-rules");
    expect(grantCalls.map((call) => [call.method, call.authorization])).toStrictEqual([
      ["GET", `Bearer ${FIXTURE}`],
      ["POST", `Bearer ${FIXTURE}`],
    ]);
    expect(grantCalls[1]?.body).toStrictEqual({
      rule: { value: "tenkai-admins", capabilities: ["read", "management"] },
      reason: "Initial administrator group",
      generation: 3,
    });
    // /healthz was read again and now reports a first administrator.
    expect(calls.filter((call) => call.path === "healthz").length).toBeGreaterThan(1);
    expect(container.textContent).not.toContain("No first administrator");
    expect(container.textContent).toContain(
      "Grant created. Members of tenkai-admins can manage this hub after they sign in again.",
    );
    expect(input("Management token")).toBeNull();
    // The token never reached the query cache.
    expect(
      JSON.stringify(
        client
          .getQueryCache()
          .getAll()
          .map((query) => query.state),
      ),
    ).not.toContain(FIXTURE);
  });

  it("shows the server's refusal inline and clears the token", async () => {
    serve(() => ({
      status: 400,
      body: { error: 'the configuration file declares claim value "viewers"; change it there' },
    }));
    await render();
    await fillAndSubmit("viewers");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'the configuration file declares claim value "viewers"; change it there',
    );
    expect(input("Management token")?.value).toBe("");
    expect(container.textContent).toContain("No first administrator");
    expect(
      JSON.stringify(
        client
          .getQueryCache()
          .getAll()
          .map((query) => query.state),
      ),
    ).not.toContain(FIXTURE);
  });

  it("shows nothing once a first administrator is configured", async () => {
    firstAdministrator = "configured";
    serve(() => ({ status: 201, body: {} }));
    await render();
    expect(container.textContent).toBe("");
  });
});
