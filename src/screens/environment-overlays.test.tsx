// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { overlayRefusal } from "../delivery/config-schema";
import { EnvironmentOverlays } from "./environment-overlays";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const REPORT = {
  subscriptions: [{ product: "api", head: "2.0.0" }],
  config: [
    {
      product: "api",
      overlay: { region: "eu" },
      defaults: { replicas: "1" },
      secrets: ["db-password"],
    },
  ],
};

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

describe("EnvironmentOverlays", () => {
  it("shows overlay and default keys as checked and secret names only", async () => {
    await render(<EnvironmentOverlays report={REPORT} />);
    expect(container.querySelector("h2")?.textContent).toBe("Overlays");
    expect(cells()).toStrictEqual([
      "api",
      "region",
      "eu",
      "overlay",
      "checked",
      "2.0.0",
      "api",
      "replicas",
      "1",
      "default",
      "checked",
      "2.0.0",
      "api",
      "db-password",
      "·",
      "secret",
      "declared",
      "2.0.0",
    ]);
    expect(container.textContent).not.toContain("s3cret");
  });

  it("shows a required-key refusal without the server sentence", async () => {
    const refusal = overlayRefusal("overlay replicas is required by the release config schema");
    await render(
      <EnvironmentOverlays
        report={{
          subscriptions: [{ product: "api", head: "2.0.0" }],
          config: [{ product: "api", overlay: { region: "eu" }, secrets: ["db-password"] }],
        }}
        {...(refusal === undefined ? {} : { refusal })}
      />,
    );
    expect(container.textContent).toContain("replicas");
    expect(container.textContent).toContain("required");
    expect(container.textContent).toContain("2.0.0");
    expect(container.textContent).not.toContain("release config schema");
  });

  it("renders nothing when inspect has no config", async () => {
    await render(<EnvironmentOverlays report={{ name: "prod" }} />);
    expect(container.textContent).toBe("");
  });
});
