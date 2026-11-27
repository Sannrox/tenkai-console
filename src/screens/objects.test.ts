import { describe, expect, it } from "vitest";
import {
  PRODUCT_TABS,
  RELEASE_TABS,
  findingSearch,
  objectEnvironment,
  parseReleaseSpec,
  releaseSpec,
  shortPlanId,
  tabAfter,
} from "./objects";

describe("object tabs", () => {
  it("reads overview from the object path and linked from the last segment", () => {
    expect(tabAfter("/products/api", "products", 1)).toBe("overview");
    expect(tabAfter("/ui/products/api", "products", 1)).toBe("overview");
    expect(tabAfter("/products/api/linked", "products", 1)).toBe("linked");
    expect(tabAfter("/releases/api/1.1.0", "releases", 2)).toBe("overview");
    expect(tabAfter("/releases/api/1.1.0/linked", "releases", 2)).toBe("linked");
    expect(tabAfter("/runners/sha256:abc", "runners", 1)).toBe("overview");
    expect(tabAfter("/findings/CVE-1/linked", "findings", 1)).toBe("linked");
  });

  it("reads product recalls and release installations from the last segment", () => {
    expect(tabAfter("/products/api/recalls", "products", 1, PRODUCT_TABS)).toBe("recalls");
    expect(tabAfter("/products/api", "products", 1, PRODUCT_TABS)).toBe("overview");
    expect(tabAfter("/releases/api/1.1.0/installations", "releases", 2, RELEASE_TABS)).toBe(
      "installations",
    );
    expect(tabAfter("/releases/api/1.1.0/linked", "releases", 2, RELEASE_TABS)).toBe("overview");
  });

  it("does not treat an id named linked as the linked tab", () => {
    expect(tabAfter("/products/linked", "products", 1)).toBe("overview");
    expect(tabAfter("/products/linked/linked", "products", 1)).toBe("linked");
  });
});

describe("release spec", () => {
  it("splits product@version and rejects a blank side", () => {
    expect(parseReleaseSpec("api@1.1.0")).toEqual({ product: "api", version: "1.1.0" });
    expect(releaseSpec("api", "1.1.0")).toBe("api@1.1.0");
    expect(parseReleaseSpec("api")).toBeUndefined();
    expect(parseReleaseSpec("@1.1.0")).toBeUndefined();
    expect(parseReleaseSpec("api@")).toBeUndefined();
  });
});

describe("search and ids", () => {
  it("keeps optional environment and finding identity", () => {
    expect(objectEnvironment({ environment: "prod" })).toEqual({ environment: "prod" });
    expect(objectEnvironment({})).toEqual({});
    expect(findingSearch({ release: "api@1.1.0", component: "openssl" })).toEqual({
      release: "api@1.1.0",
      component: "openssl",
    });
    expect(shortPlanId("tenkai:plan:prod:41")).toBe("41");
  });
});
