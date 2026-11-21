import { describe, expect, it } from "vitest";
import { tabFromPath } from "./environment-page";

describe("environment object tabs", () => {
  it("reads overview from the environment path and named tabs from the last segment", () => {
    expect(tabFromPath("/environments/prod")).toBe("overview");
    expect(tabFromPath("/ui/environments/prod")).toBe("overview");
    expect(tabFromPath("/environments/prod/instances")).toBe("instances");
    expect(tabFromPath("/environments/prod/history")).toBe("history");
    expect(tabFromPath("/environments/prod/settings")).toBe("settings");
    expect(tabFromPath("/environments/prod/security")).toBe("security");
    expect(tabFromPath("/environments/prod/linked")).toBe("linked");
  });

  it("does not treat an environment named history as the history tab", () => {
    expect(tabFromPath("/environments/history")).toBe("overview");
    expect(tabFromPath("/environments/history/history")).toBe("history");
  });
});
