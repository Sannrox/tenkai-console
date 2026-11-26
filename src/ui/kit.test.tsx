// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ActionsMenu, ConfirmButton, headingCount, ObjectPage } from "./kit";
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
  it("shows one name, status, properties, tabs, attention, main and linked", async () => {
    await act(async () => {
      root.render(
        <ObjectPage
          kind="Environment"
          name="prod"
          status="unhealthy"
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
    expect(container.querySelector("h1")?.textContent).toBe("prod");
    expect(container.textContent).not.toMatch(/^Environment/);
    expect(container.querySelector("h1")?.previousElementSibling).toBeNull();
    expect(container.textContent).toContain("unhealthy");
    expect(container.textContent).toContain("Instances");
    expect(container.textContent).toContain("platform-team");
    expect(container.textContent).toContain("Overview");
    expect(container.textContent).toContain("api-1 health check failing");
    expect(container.textContent).toContain("plan 41");
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.getAttribute("aria-label") === "Actions")
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

describe("ActionsMenu", () => {
  it("marks Retry as needed with a static point, not a count", async () => {
    await act(async () => {
      root.render(<ActionsMenu needed items={[{ label: "Retry", onClick: () => undefined }]} />);
    });
    const trigger = container.querySelector('[aria-label="Actions"]');
    expect(trigger?.getAttribute("data-needed")).toBe("true");
    expect(trigger?.querySelector(".bg-danger")).toBeTruthy();
    expect(trigger?.textContent).toBe("Actions");
  });

  it("keeps ConfirmButton two-click inside the open menu", async () => {
    const sent: string[] = [];
    await act(async () => {
      root.render(
        <ActionsMenu>
          <ConfirmButton
            label="Reconcile"
            confirm="Run one reconcile tick"
            disabled={false}
            onConfirm={() => sent.push("tick")}
          />
        </ActionsMenu>,
      );
    });
    await act(async () => {
      container
        .querySelector('[aria-label="Actions"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.textContent).toContain("Reconcile");
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Reconcile")
        ?.click();
    });
    expect(container.textContent).toContain("Run one reconcile tick");
    expect(container.textContent).toContain("Cancel");
    expect(container.querySelector('[aria-label="Actions"]')?.getAttribute("data-needed")).toBe(
      "true",
    );
    expect(sent).toEqual([]);
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Run one reconcile tick")
        ?.click();
    });
    expect(sent).toEqual(["tick"]);
  });

  it("puts the unknown sentence in the menu as a status line", async () => {
    await act(async () => {
      root.render(
        <ActionsMenu
          needed
          status="No answer from the server; the outcome is unknown until the next inspect."
          items={[{ label: "Reconcile", onClick: () => undefined }]}
        />,
      );
    });
    await act(async () => {
      container
        .querySelector('[aria-label="Actions"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector("[role='status']")?.textContent).toBe(
      "No answer from the server; the outcome is unknown until the next inspect.",
    );
  });
});

describe("headingCount", () => {
  it("keeps incomplete and unknown in the count slot", () => {
    expect(headingCount("4 environments", "incomplete")).toBe("4 environments · list incomplete");
    expect(headingCount("12 environments", "unknown")).toBe("12 environments · outcome unknown");
    expect(headingCount("6 instances")).toBe("6 instances");
  });
});
