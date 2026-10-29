// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSession } from "../auth/session";
import { SignedIn } from "./signed-in";

// The signed-in layout's router pieces are not under test here.
vi.mock("./top-bar", () => ({ TopBar: () => null }));
vi.mock("@tanstack/react-router", () => ({ Outlet: () => null }));

// React's act() needs this flag outside a test renderer.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  useSession.setState({
    session: {
      kind: "token",
      accessToken: "signed-in",
      subject: "new-user",
      expiresAt: undefined,
      refreshToken: undefined,
      idToken: undefined,
    },
    refused: [],
  });
  // A first-run hub: the account has no grant, and no administrator exists.
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
      if (path === "/healthz") {
        return new Response(JSON.stringify({ status: "ok", first_administrator: "missing" }));
      }
      return new Response(JSON.stringify({ error: "insufficient delivery capability" }), {
        status: 403,
      });
    }),
  );
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
});

describe("SignedIn", () => {
  it("offers first-administrator setup on the no-access screen", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <SignedIn settings={null} />
        </QueryClientProvider>,
      );
    });
    for (let round = 0; round < 6; round += 1) {
      await act(async () => {
        await new Promise((resolve) => {
          setTimeout(resolve, 0);
        });
      });
    }
    expect(container.textContent).toContain("has no Tenkai access");
    expect(container.textContent).toContain("No first administrator");
    const setUp = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Set up",
    );
    await act(async () => {
      setUp?.click();
    });
    expect(container.querySelector('input[aria-label="Management token"]')).not.toBeNull();
  });
});
