const COLLAPSED_KEY = "tenkai.sidebar.collapsed";

/** Platform screens stay at their current paths and share one tab strip. */
export const PLATFORM_TABS = [
  { label: "Server", to: "/server" },
  { label: "Trust", to: "/trust" },
  { label: "Imports", to: "/imports" },
  { label: "Operations", to: "/operations" },
  { label: "Access", to: "/access" },
] as const;

/** Places in the desktop rail. Environments is `/`. */
export const APP_ITEMS = [
  { label: "Environments", to: "/", icon: "environments" },
  { label: "Releases", to: "/releases", icon: "releases" },
  { label: "Exposure", to: "/exposure", icon: "exposure" },
  { label: "Runners", to: "/runners", icon: "runners" },
  { label: "Platform", to: "/server", icon: "platform" },
] as const;

/** Phone More list: catalog and platform, plus Attention. */
export const MORE_ITEMS = [
  { label: "Exposure", to: "/exposure", icon: "exposure" },
  { label: "Runners", to: "/runners", icon: "runners" },
  { label: "Platform", to: "/server", icon: "platform" },
  { label: "Attention", to: "/attention", icon: "attention" },
] as const;

/** Phone bottom bar after Search (overlay). */
export const PHONE_ITEMS = [
  { label: "Env", to: "/", icon: "environments" },
  { label: "Rel", to: "/releases", icon: "releases" },
  { label: "More", to: "/apps", icon: "apps" },
] as const;

export const isPlatformPath = (path: string) => PLATFORM_TABS.some((tab) => tab.to === path);

/** Which phone-bar place the current path belongs to. */
export const activePhone = (path: string): "Env" | "Rel" | "More" => {
  if (path === "/" || path.startsWith("/environments") || path.startsWith("/plans")) {
    return "Env";
  }
  if (path.startsWith("/releases") || path.startsWith("/products")) {
    return "Rel";
  }
  return "More";
};

export const appItemActive = (path: string, to: string) => {
  if (to === "/server") {
    return isPlatformPath(path);
  }
  if (to === "/") {
    return path === "/" || path.startsWith("/environments") || path.startsWith("/plans");
  }
  if (to === "/releases") {
    return path.startsWith("/releases") || path.startsWith("/products");
  }
  if (to === "/exposure") {
    return path.startsWith("/exposure") || path.startsWith("/findings");
  }
  if (to === "/runners") {
    return path.startsWith("/runners");
  }
  return path === to;
};

export const readCollapsed = (): boolean => {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
};

export const writeCollapsed = (collapsed: boolean) => {
  try {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // private mode: the choice lasts for this visit only
  }
};
