import { shortId } from "./runners";

export type SearchKind = "environment" | "product" | "release" | "runner" | "finding" | "plan";

export type SearchHit = {
  kind: SearchKind;
  key: string;
  title: string;
  detail: string;
  runnerId?: string;
  advisory?: string;
  release?: string;
  component?: string;
};

export type SearchCatalog = {
  environments: ReadonlyArray<{ name: string }>;
  products: readonly string[];
  releases: ReadonlyArray<{ product: string; version: string }>;
  runners: ReadonlyArray<{ id: string; environment: string }>;
  findings: ReadonlyArray<{ advisory_id: string; release: string; component: string }>;
};

const has = (value: string, needle: string) => value.toLowerCase().includes(needle);

/**
 * Name search over the same list catalogs the screens already load. A plan
 * is not listed; a single-token query is offered as an exact plan id.
 */
export const searchHits = (query: string, catalog: SearchCatalog): SearchHit[] => {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) {
    return [];
  }
  const hits: SearchHit[] = [];
  for (const environment of catalog.environments) {
    if (has(environment.name, needle)) {
      hits.push({
        kind: "environment",
        key: `environment:${environment.name}`,
        title: environment.name,
        detail: "environment",
      });
    }
  }
  for (const product of catalog.products) {
    if (has(product, needle)) {
      hits.push({
        kind: "product",
        key: `product:${product}`,
        title: product,
        detail: "product",
      });
    }
  }
  for (const release of catalog.releases) {
    const spec = `${release.product}@${release.version}`;
    if (has(spec, needle) || has(release.product, needle) || has(release.version, needle)) {
      hits.push({
        kind: "release",
        key: `release:${spec}`,
        title: spec,
        detail: "release",
      });
    }
  }
  for (const runner of catalog.runners) {
    if (
      has(runner.id, needle) ||
      has(shortId(runner.id), needle) ||
      has(runner.environment, needle)
    ) {
      hits.push({
        kind: "runner",
        key: `runner:${runner.id}`,
        title: shortId(runner.id),
        detail: runner.environment,
        runnerId: runner.id,
      });
    }
  }
  for (const finding of catalog.findings) {
    if (
      has(finding.advisory_id, needle) ||
      has(finding.release, needle) ||
      has(finding.component, needle)
    ) {
      hits.push({
        kind: "finding",
        key: `finding:${finding.advisory_id}:${finding.release}:${finding.component}`,
        title: finding.advisory_id,
        detail: `${finding.release} · ${finding.component}`,
        advisory: finding.advisory_id,
        release: finding.release,
        component: finding.component,
      });
    }
  }
  const exact = query.trim();
  if (!/\s/.test(exact)) {
    hits.push({
      kind: "plan",
      key: `plan:${exact}`,
      title: exact,
      detail: "plan",
    });
  }
  return hits.slice(0, 30);
};
