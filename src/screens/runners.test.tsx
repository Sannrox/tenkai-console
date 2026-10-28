// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeRunner } from "../api/tenkai.gen";
import { useSession } from "../auth/session";
import { Enroll, Runners } from "./runners";

const ENROLL = "fixture";
const RUNNER: RuntimeRunner = {
  id: "sha256:0123456789abcdef0123",
  environment: "prod",
  state: "active",
  instances: [],
};

// React's act() needs this flag outside a test renderer.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Reply = { status?: number; body: unknown };

/** A fetch stub answering by method and path; records what was sent. */
const server = (answer: (method: string, path: string) => Reply) => {
  const sent: Array<{ method: string; path: string; body: unknown }> = [];
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
    const path = new URL(url).pathname.replace(/^\//, "");
    const method = init?.method ?? "GET";
    const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    sent.push({ method, path, body });
    const reply = answer(method, path);
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
  });
  vi.stubGlobal("fetch", fetcher);
  return sent;
};

let root: Root;
let container: HTMLElement;

const render = async (ui: ReactNode) => {
  const client = new QueryClient({
    defaultOptions: { mutations: { networkMode: "always", retry: false } },
  });
  await act(async () => {
    root.render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  });
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

const button = (label: string) =>
  [...container.querySelectorAll("button")].find((element) => element.textContent === label);

const click = async (label: string) => {
  const target = button(label);
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

describe("Enroll", () => {
  it("shows the token once and drops it on Done", async () => {
    const sent = server(() => ({
      body: { environment: "prod", token: ENROLL, expires_at: 1_900_000_000_000 },
    }));
    const onClose = vi.fn<() => void>();
    await render(
      <Enroll token="operator" environments={["prod"]} preferred="prod" onClose={onClose} />,
    );
    await click("Issue token");
    await click("Issue a token for prod");
    expect(sent).toStrictEqual([
      { method: "POST", path: "v1/environments/prod/runtime-enrollments", body: {} },
    ]);
    expect(container.textContent).toContain(["TENKAI_RUNTIME_ENROLLMENT_TOKEN", ENROLL].join("="));

    await click("Done, clear token");
    expect(onClose).toHaveBeenCalledOnce();
    expect(container.textContent).not.toContain(ENROLL);
    expect(button("Issue token")).toBeDefined();
  });
});

describe("Runners", () => {
  it("shows a revoked runner as revoked after the refresh that follows revoke", async () => {
    let revoked = false;
    const sent = server((method, path) => {
      if (method === "POST") {
        revoked = true;
        return {
          body: { credential_id: RUNNER.id, environment: "prod", revoked_at: 1_900_000_000_000 },
        };
      }
      if (path === "v1/environments") {
        return { body: [] };
      }
      return { body: { runners: [{ ...RUNNER, state: revoked ? "revoked" : "active" }] } };
    });
    await render(<Runners />);
    await settle();
    expect(container.querySelector("tbody")?.textContent).toContain("active");

    await click("Revoke");
    await type("Revoke reason for sha256:0123456789ab", "host retired");
    await click("Revoke");
    await click("Revoke sha256:0123456789ab of prod");
    expect(sent.find((call) => call.method === "POST")).toStrictEqual({
      method: "POST",
      path: "v1/runners/sha256%3A0123456789abcdef0123/revoke",
      body: { reason: "host retired" },
    });
    expect(container.querySelector("tbody")?.textContent).toContain("revoked");
    expect(button("Revoke")).toBeUndefined();
  });

  it("shows a refused credential no enroll or revoke controls", async () => {
    server((_method, path) =>
      path === "v1/runners"
        ? { status: 403, body: { error: "insufficient delivery capability" } }
        : { body: [] },
    );
    await render(<Runners />);
    await settle();
    expect(container.textContent).toContain("insufficient delivery capability");
    expect(button("Enroll runner")).toBeUndefined();
    expect(button("Revoke")).toBeUndefined();
  });
});
