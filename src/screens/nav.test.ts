// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import {
  activeMain,
  appItemActive,
  isAppPath,
  isPlatformPath,
  readCollapsed,
  writeCollapsed,
} from "./nav";

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

  it("keeps the plan page under Environments and Platform under Apps", () => {
    expect(isAppPath("/environments")).toBe(true);
    expect(isAppPath("/environments/prod/plan")).toBe(true);
    expect(isAppPath("/server")).toBe(true);
    expect(isAppPath("/apps")).toBe(true);
    expect(isAppPath("/")).toBe(false);
    expect(isAppPath("/search")).toBe(false);
    expect(appItemActive("/environments/prod/plan", "/environments")).toBe(true);
    expect(appItemActive("/trust", "/server")).toBe(true);
    expect(appItemActive("/releases", "/releases")).toBe(true);
    expect(appItemActive("/releases", "/environments")).toBe(false);
  });

  it("maps paths onto Home, Search, Attention or Apps", () => {
    expect(activeMain("/")).toBe("Home");
    expect(activeMain("/search")).toBe("Search");
    expect(activeMain("/attention")).toBe("Attention");
    expect(activeMain("/environments")).toBe("Apps");
    expect(activeMain("/access")).toBe("Apps");
    expect(activeMain("/apps")).toBe("Apps");
  });

  it("remembers the collapsed sidebar in this browser", () => {
    expect(readCollapsed()).toBe(false);
    writeCollapsed(true);
    expect(readCollapsed()).toBe(true);
    writeCollapsed(false);
    expect(readCollapsed()).toBe(false);
  });
});
