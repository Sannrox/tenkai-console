// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { activePhone, appItemActive, isPlatformPath, readCollapsed, writeCollapsed } from "./nav";

describe("nav", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("treats server, trust, imports, operations and access as Platform", () => {
    expect(isPlatformPath("/server")).toBe(true);
    expect(isPlatformPath("/trust")).toBe(true);
    expect(isPlatformPath("/imports")).toBe(true);
    expect(isPlatformPath("/operations")).toBe(true);
    expect(isPlatformPath("/access")).toBe(true);
    expect(isPlatformPath("/environments")).toBe(false);
    expect(isPlatformPath("/")).toBe(false);
  });

  it("keeps the plan page under Environments and objects under their place", () => {
    expect(appItemActive("/", "/")).toBe(true);
    expect(appItemActive("/environments/prod", "/")).toBe(true);
    expect(appItemActive("/environments/prod/plan", "/")).toBe(true);
    expect(appItemActive("/plans/tenkai:plan:1", "/")).toBe(true);
    expect(appItemActive("/trust", "/server")).toBe(true);
    expect(appItemActive("/releases", "/releases")).toBe(true);
    expect(appItemActive("/products/api", "/releases")).toBe(true);
    expect(appItemActive("/releases/api/1.1.0", "/releases")).toBe(true);
    expect(appItemActive("/findings/CVE-1", "/exposure")).toBe(true);
    expect(appItemActive("/releases", "/")).toBe(false);
    expect(appItemActive("/attention", "/")).toBe(false);
  });

  it("maps paths onto Env, Rel or More on the phone bar", () => {
    expect(activePhone("/")).toBe("Env");
    expect(activePhone("/environments/prod")).toBe("Env");
    expect(activePhone("/plans/tenkai:plan:1")).toBe("Env");
    expect(activePhone("/releases")).toBe("Rel");
    expect(activePhone("/products/api")).toBe("Rel");
    expect(activePhone("/attention")).toBe("More");
    expect(activePhone("/apps")).toBe("More");
    expect(activePhone("/exposure")).toBe("More");
    expect(activePhone("/access")).toBe("More");
  });

  it("remembers the collapsed sidebar in this browser", () => {
    expect(readCollapsed()).toBe(false);
    writeCollapsed(true);
    expect(readCollapsed()).toBe(true);
    writeCollapsed(false);
    expect(readCollapsed()).toBe(false);
  });
});
