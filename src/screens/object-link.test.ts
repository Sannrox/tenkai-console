import { describe, expect, it } from "vitest";
import { matchesSaved } from "./object-link";

describe("matchesSaved", () => {
  it("matches a release by product and version, not the spec string", () => {
    const item = { kind: "release" as const, name: "api@1.1.0", id: "api@1.1.0" };
    expect(matchesSaved("/releases/api/1.1.0", item)).toBe(true);
    expect(matchesSaved("/releases/api/1.1.0/linked", item)).toBe(true);
    expect(matchesSaved("/releases/api/1.0.0", item)).toBe(false);
    expect(matchesSaved("/products/api", item)).toBe(false);
  });

  it("matches environment, product and plan routes", () => {
    expect(
      matchesSaved("/environments/prod/history", {
        kind: "environment",
        name: "prod",
        id: "prod",
      }),
    ).toBe(true);
    expect(matchesSaved("/products/api/linked", { kind: "product", name: "api", id: "api" })).toBe(
      true,
    );
    expect(
      matchesSaved("/plans/tenkai:plan:1", {
        kind: "plan",
        name: "api 1.0.0 → 1.1.0",
        id: "tenkai:plan:1",
      }),
    ).toBe(true);
  });
});
