// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigPresets } from "./config-presets";

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

describe("ConfigPresets", () => {
  it("says none when the plan has no presets", async () => {
    await render(<ConfigPresets plan={{ id: "tenkai:plan:1" }} />);
    expect(container.querySelector("h2")?.textContent).toBe("Config");
    expect(container.textContent).toContain("No presets on this plan");
  });

  it("shows the selected preset, overrides, and conflicts without applying them", async () => {
    await render(
      <ConfigPresets
        plan={{
          config_presets: [
            {
              product: "api",
              preset: "large",
              from_preset: ["region"],
              overridden: ["replicas"],
              conflicts: ["replicas: override 3 hides preset large change 5 -> 8"],
            },
          ],
        }}
      />,
    );
    expect(container.textContent).toContain("api preset large");
    expect(container.textContent).toContain("from preset: region");
    expect(container.textContent).toContain("overridden: replicas");
    expect(container.querySelector("[role='alert']")?.textContent).toBe(
      "conflict: replicas: override 3 hides preset large change 5 -> 8",
    );
    expect(container.textContent).toContain("Nothing is changed without a plan");
  });
});
