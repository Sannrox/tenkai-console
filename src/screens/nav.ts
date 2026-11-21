const COLLAPSED_KEY = "tenkai.sidebar.collapsed";

/** Platform screens stay at their current paths and share one tab strip. */
export const PLATFORM_TABS = [
  { label: "Server", to: "/server" },
  { label: "Trust", to: "/trust" },
  { label: "Imports", to: "/imports" },
  { label: "Operations", to: "/operations" },
  { label: "Access", to: "/access" },
] as const;

/** Apps in the sidebar and on the phone Apps page. */
export const APP_ITEMS = [
  { label: "Environments", to: "/environments", icon: "environments" },
  { label: "Releases", to: "/releases", icon: "releases" },
  { label: "Exposure", to: "/exposure", icon: "exposure" },
  { label: "Runners", to: "/runners", icon: "runners" },
  { label: "Platform", to: "/server", icon: "platform" },
] as const;

export const MAIN_ITEMS = [
  { label: "Search", to: "/search", icon: "search" },
  { label: "Home", to: "/", icon: "home" },
  { label: "Attention", to: "/attention", icon: "attention" },
] as const;

/** Phone bottom bar: the same Main items plus Apps. */
export const PHONE_ITEMS = [...MAIN_ITEMS, { label: "Apps", to: "/apps", icon: "apps" }] as const;

export const isPlatformPath = (path: string) => PLATFORM_TABS.some((tab) => tab.to === path);

export const isAppPath = (path: string) =>
  path === "/apps" ||
  path.startsWith("/environments") ||
  path.startsWith("/releases") ||
  path.startsWith("/products") ||
  path.startsWith("/plans") ||
  path.startsWith("/findings") ||
  path.startsWith("/exposure") ||
  path.startsWith("/runners") ||
  isPlatformPath(path);

/** Which bottom-bar / primary item the current path belongs to. */
export const activeMain = (path: string): "Search" | "Home" | "Attention" | "Apps" => {
  if (path === "/search") {
    return "Search";
  }
  if (path === "/attention") {
    return "Attention";
  }
  if (isAppPath(path)) {
    return "Apps";
  }
  return "Home";
};

export const appItemActive = (path: string, to: string) => {
  if (to === "/server") {
    return isPlatformPath(path);
  }
  if (to === "/environments") {
    return path.startsWith("/environments") || path.startsWith("/plans");
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
