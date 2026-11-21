import { describe, expect, it } from "vitest";
import { searchHits, type SearchCatalog } from "./search";

const catalog: SearchCatalog = {
  environments: [{ name: "prod" }, { name: "edge-eu" }],
  products: ["api", "web"],
  releases: [
    { product: "api", version: "1.1.0" },
    { product: "web", version: "2.0.0" },
  ],
  runners: [{ id: "sha256:0123456789abcdef0123", environment: "prod" }],
  findings: [{ advisory_id: "TENKAI-2026-1", release: "api@1.0.0", component: "openssl" }],
};

describe("search hits", () => {
  it("matches environments, products, releases, runners and findings by name", () => {
    expect(searchHits("prod", catalog).map((hit) => hit.kind)).toEqual([
      "environment",
      "runner",
      "plan",
    ]);
    expect(searchHits("api", catalog).map((hit) => [hit.kind, hit.title])).toEqual([
      ["product", "api"],
      ["release", "api@1.1.0"],
      ["finding", "TENKAI-2026-1"],
      ["plan", "api"],
    ]);
    expect(searchHits("TENKAI", catalog).find((hit) => hit.kind === "finding")).toMatchObject({
      title: "TENKAI-2026-1",
      release: "api@1.0.0",
      component: "openssl",
    });
    expect(searchHits("sha256:0123", catalog).find((hit) => hit.kind === "runner")).toMatchObject({
      runnerId: "sha256:0123456789abcdef0123",
    });
  });

  it("offers a plan by exact id and ignores an empty query", () => {
    expect(searchHits("", catalog)).toEqual([]);
    expect(searchHits("  ", catalog)).toEqual([]);
    expect(searchHits("tenkai:plan:1", catalog).at(-1)).toMatchObject({
      kind: "plan",
      title: "tenkai:plan:1",
    });
    expect(searchHits("two words", catalog).some((hit) => hit.kind === "plan")).toBe(false);
  });
});
