/**
 * Object-page paths and tabs. Overview is the bare object URL; named tabs
 * are the last segment after the id.
 */

export const OBJECT_TABS = [
  { id: "overview", label: "Overview" },
  { id: "linked", label: "Linked" },
] as const;

export const PRODUCT_TABS = [
  { id: "overview", label: "Overview" },
  { id: "recalls", label: "Recalls" },
  { id: "linked", label: "Linked" },
] as const;

export const RELEASE_TABS = [
  { id: "overview", label: "Overview" },
  { id: "installations", label: "Installations" },
] as const;

export type ObjectTab = (typeof OBJECT_TABS)[number]["id"];
export type ProductTab = (typeof PRODUCT_TABS)[number]["id"];
export type ReleaseTab = (typeof RELEASE_TABS)[number]["id"];

/**
 * Tab after `root` plus `idSegments` id parts. `/ui` prefixes are ignored;
 * an id that looks like a tab stays an id.
 */
export function tabAfter(pathname: string, root: string, idSegments: number): ObjectTab;
export function tabAfter<T extends string>(
  pathname: string,
  root: string,
  idSegments: number,
  tabs: readonly { id: T }[],
): T;
export function tabAfter(
  pathname: string,
  root: string,
  idSegments: number,
  tabs: readonly { id: string }[] = OBJECT_TABS,
): string {
  const ids = new Set(tabs.map((tab) => tab.id));
  const parts = pathname.split("/").filter(Boolean);
  const start = parts.lastIndexOf(root);
  if (start < 0) {
    return "overview";
  }
  const tab = parts[start + 1 + idSegments];
  if (tab !== undefined && ids.has(tab) && tab !== "overview") {
    return tab;
  }
  return "overview";
}

/** `product@version` as the catalog writes it. */
export const parseReleaseSpec = (
  spec: string,
): { product: string; version: string } | undefined => {
  const at = spec.lastIndexOf("@");
  if (at <= 0 || at === spec.length - 1 || /\s/.test(spec)) {
    return undefined;
  }
  return { product: spec.slice(0, at), version: spec.slice(at + 1) };
};

export const releaseSpec = (product: string, version: string): string => `${product}@${version}`;

export const shortPlanId = (id: string): string => id.split(":").at(-1)?.slice(0, 8) ?? id;

export const objectEnvironment = (search: Record<string, unknown>): { environment?: string } => {
  const environment = typeof search.environment === "string" ? search.environment : undefined;
  return environment === undefined ? {} : { environment };
};

export const findingSearch = (
  search: Record<string, unknown>,
): { release?: string; component?: string } => {
  const release = typeof search.release === "string" ? search.release : undefined;
  const component = typeof search.component === "string" ? search.component : undefined;
  return {
    ...(release === undefined ? {} : { release }),
    ...(component === undefined ? {} : { component }),
  };
};
