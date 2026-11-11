// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EnvironmentIssuer } from "./environment-issuer";

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

describe("EnvironmentIssuer", () => {
  it("says the server does not report an issuer when the field is missing", async () => {
    await render(<EnvironmentIssuer report={{ name: "prod" }} />);
    expect(container.querySelector("h2")?.textContent).toBe("Identity issuer");
    expect(container.textContent).toContain("This server does not report an identity issuer.");
    expect(container.querySelector("button")).toBeNull();
  });

  it("says none when there is no issuer", async () => {
    await render(<EnvironmentIssuer report={{ identity_issuer: {} }} />);
    expect(container.textContent).toContain("none");
    expect(container.querySelector("table")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
  });

  it("shows a blocked rotation with waiting instance names, not a count", async () => {
    await render(
      <EnvironmentIssuer
        report={{
          identity_issuer: {
            current: {
              fingerprint: "ab",
              generation: 1,
              recipients: ["runtime:prod-a"],
            },
            next: { fingerprint: "cd", generation: 2, recipients: [] },
          },
          identity_issuer_waiting: [
            "api (bundle without the next issuer)",
            "web (bundle written too recently)",
          ],
        }}
      />,
    );
    expect(container.textContent).toContain("blocked");
    expect(cells()).toStrictEqual([
      "current",
      "ab",
      "1",
      "runtime:prod-a",
      "next",
      "cd",
      "2",
      "lost",
    ]);
    expect(container.textContent).toContain("api (bundle without the next issuer)");
    expect(container.textContent).toContain("web (bundle written too recently)");
    expect(container.textContent).not.toContain("2 waiting");
    expect(container.querySelector("button")).toBeNull();
  });
});
