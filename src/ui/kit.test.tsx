// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ActionsMenu, ObjectPage } from "./kit";
import { reloadSaved, useSaved } from "./saved";

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
  localStorage.clear();
  reloadSaved();
});

describe("ObjectPage", () => {
  it("shows type, name, status, properties, tabs, attention, main and linked", async () => {
    await act(async () => {
      root.render(
        <ObjectPage
          kind="Environment"
          name="prod"
          status="unhealthy"
          primary={<button type="button">Open plan</button>}
          actions={<ActionsMenu items={[{ label: "Hold delivery", onClick: () => undefined }]} />}
          properties={[
            { label: "Instances", value: "3" },
            { label: "Owner", value: "platform-team" },
          ]}
          tabs={<nav>Overview</nav>}
          attention={<p>api-1 health check failing</p>}
          main={
            <table>
              <tbody>
                <tr>
                  <td>api-1</td>
                </tr>
              </tbody>
            </table>
          }
          linked={<p>plan 41</p>}
        />,
      );
    });
    expect(container.textContent).toContain("Environment");
    expect(container.querySelector("h1")?.textContent).toBe("prod");
    expect(container.textContent).toContain("unhealthy");
    expect(container.textContent).toContain("Open plan");
    expect(container.textContent).toContain("Instances");
    expect(container.textContent).toContain("platform-team");
    expect(container.textContent).toContain("Overview");
    expect(container.textContent).toContain("api-1 health check failing");
    expect(container.textContent).toContain("plan 41");
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Actions")
        ?.click();
    });
    expect(container.textContent).toContain("Hold delivery");
  });

  it("pins from the star and records the object as recent", async () => {
    await act(async () => {
      root.render(<ObjectPage kind="Environment" name="prod" />);
    });
    expect(useSaved.getState().recent[0]).toEqual({
      kind: "environment",
      name: "prod",
      id: "prod",
    });
    const pin = [...container.querySelectorAll("button")].find(
      (button) => button.getAttribute("aria-label") === "Pin",
    );
    expect(pin).toBeTruthy();
    await act(async () => {
      pin?.click();
    });
    expect(useSaved.getState().pins[0]?.name).toBe("prod");
    expect(container.querySelector('[aria-label="Unpin"]')).toBeTruthy();
  });
});
