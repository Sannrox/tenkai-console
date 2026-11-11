// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EnvironmentDrift } from "./environment-drift";

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

const cells = () => [...container.querySelectorAll("tbody td")].map((cell) => cell.textContent);

describe("EnvironmentDrift", () => {
  it("says the server does not report drift when the field is missing", async () => {
    await render(
      <EnvironmentDrift report={{ subscriptions: [{ product: "api", head: "1.0.0" }] }} />,
    );
    expect(container.querySelector("h2")?.textContent).toBe("Drift");
    expect(container.textContent).toContain("This server does not report drift.");
    expect(container.querySelector("button")).toBeNull();
  });

  it("says none when every instance is current", async () => {
    await render(
      <EnvironmentDrift
        report={{
          subscriptions: [{ product: "api", head: "1.0.0", spec_drift: { status: "current" } }],
        }}
      />,
    );
    expect(container.textContent).toContain("none");
    expect(container.querySelector("table")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
  });

  it("shows drifted objects, field names, and a held release with no actions", async () => {
    await render(
      <EnvironmentDrift
        report={{
          subscriptions: [
            {
              product: "api",
              instance: "api",
              head: "1.2.0",
              deployed: "1.1.0",
              delivery_hold: { actor: "alice", held_at: 1, reason: "soak" },
              spec_drift: {
                status: "modified outside Tenkai",
                objects: [
                  {
                    kind: "Deployment",
                    name: "api",
                    status: "modified outside Tenkai",
                    fields: ["containers", "env"],
                  },
                ],
              },
            },
          ],
        }}
      />,
    );
    expect(cells()).toStrictEqual([
      "api",
      "1.1.0",
      "Deployment/api",
      "containers, env",
      "drifted",
      "held",
    ]);
    expect(container.querySelector("button")).toBeNull();
    expect(container.textContent).not.toContain("SECRET");
  });
});
