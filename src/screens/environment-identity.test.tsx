// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EnvironmentIdentity } from "./environment-identity";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

const render = async (ui: Parameters<Root["render"]>[0]) => {
  await act(async () => {
    root.render(ui);
  });
};

const NOW = 1_700_000_000_000;
const cells = () => [...container.querySelectorAll("tbody td")].map((cell) => cell.textContent);

describe("EnvironmentIdentity", () => {
  it("says the server does not report identity when the route is missing", async () => {
    await render(
      <EnvironmentIdentity
        environment="prod"
        instances={["api"]}
        load={{ kind: "unavailable" }}
        now={NOW}
      />,
    );
    expect(container.querySelector("h2")?.textContent).toBe("Identity");
    expect(container.textContent).toContain("This server does not report instance identity.");
    expect(container.querySelector("button")).toBeNull();
  });

  it("says none when no instance has a certificate", async () => {
    await render(
      <EnvironmentIdentity
        environment="prod"
        instances={["api"]}
        load={{ kind: "ok", value: [{ product: "api" }] }}
        now={NOW}
      />,
    );
    expect(container.textContent).toContain("none");
    expect(container.querySelector("table")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
  });

  it("shows near expiry in the table with the URI and expiry time", async () => {
    await render(
      <EnvironmentIdentity
        environment="prod"
        instances={["api"]}
        load={{
          kind: "ok",
          value: [
            {
              product: "api",
              certificate: { expires_at: 1_700_000_3600, near_expiry: true },
            },
          ],
        }}
        now={NOW}
      />,
    );
    expect(cells()).toStrictEqual([
      "api",
      "tenkai://prod/api",
      "near expiry",
      new Date(1_700_000_3600 * 1000).toISOString(),
      "none",
    ]);
    expect(container.querySelector("button")).toBeNull();
  });

  it("labels a failed renewal as renewing, not as a plan", async () => {
    await render(
      <EnvironmentIdentity
        environment="prod"
        instances={["api"]}
        load={{
          kind: "ok",
          value: [
            {
              product: "api",
              certificate: {
                expires_at: 1_700_003_600,
                near_expiry: false,
                renewal_failure: "runtime unreachable",
              },
            },
          ],
        }}
        now={NOW}
      />,
    );
    expect(container.textContent).toContain("renewing");
    expect(container.textContent).toContain("runtime unreachable");
    expect(container.textContent).not.toContain("plan");
    expect(container.querySelector("button")).toBeNull();
  });
});
