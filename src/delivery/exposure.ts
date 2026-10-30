import type {
  AdvisoryFeedStatus,
  ChangeEvent,
  CriticalityLevel,
  EffectiveCriticality,
  ExposureQueryResult,
  Freshness,
} from "../api/tenkai.gen";
/**
 * Exposure query, advisory-feed status, and result rows for the Exposure
 * screen (Sannrox/tenkai-console#41). Labels and CSV only; every value is
 * the server's. `GET /v1/exposures` takes the same query string as
 * `tenkaictl exposure query`.
 */

/** `GET /v1/exposures` path for the same inputs as the CLI. */
export const exposureQueryPath = (component: string, range: string): string => {
  const query = new URLSearchParams({ component, range });
  return `v1/exposures?${query}`;
};

/** Compact duration from a millisecond span, same buckets as runner last-pull. */
export const ageMs = (ms: number): string => {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) {
    return "<1m";
  }
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
};

/**
 * First-line advisory-feed status: last import, age, and whether a feed
 * exists for the stale-feed gate. The gate itself is environment policy
 * applied at plan start.
 */
export const feedLine = (status: AdvisoryFeedStatus): string => {
  if (!status.imported) {
    return "no advisory feed imported · stale-feed gate: no feed";
  }
  return `last import ${new Date(status.imported_at).toISOString()} · age ${ageMs(status.age_ms)} · stale-feed gate: feed present`;
};

/** Hub observations stay current; isolated spokes are as-of the last bundle. */
export const freshnessLabel = (freshness: Freshness): string => {
  if (freshness.kind === "hub") {
    return "live";
  }
  if (freshness.kind === "as_of_last_bundle_import") {
    return `as of bundle ${new Date(freshness.imported_at).toISOString()}`;
  }
  return "unknown";
};

/** Effective level, marked when derived criticality is what still counts. */
export const criticalityLabel = (
  level: CriticalityLevel | undefined,
  product: EffectiveCriticality | undefined,
): string => {
  if (level === undefined) {
    return "·";
  }
  const derived = product?.derived?.level === level && product.declared?.level !== level;
  return derived ? `${level} (derived)` : level;
};

export type ExposureRow = {
  environment: string;
  release: string;
  componentVersion: string;
  criticality: string;
  freshness: string;
  product: string;
};

/** One table row per matching environment; catalog-only matches keep a row. */
export const exposureRows = (
  result: ExposureQueryResult,
  products: Readonly<Record<string, EffectiveCriticality | undefined>> = {},
): ExposureRow[] =>
  result.matches.flatMap((match) => {
    const product = products[match.product];
    const catalog = {
      environment: "·",
      release: match.release,
      componentVersion: match.component_version,
      criticality: criticalityLabel(match.criticality, product),
      freshness: "·",
      product: match.product,
    };
    if (match.environments.length === 0) {
      return [catalog];
    }
    return match.environments.map((environment) => ({
      environment: environment.environment,
      release: environment.deployed_release,
      componentVersion: match.component_version,
      criticality: criticalityLabel(environment.criticality ?? match.criticality, product),
      freshness: freshnessLabel(environment.freshness),
      product: match.product,
    }));
  });

/** Distinct catalog releases in query order, for a fix-forward recall. */
export const uniqueReleases = (result: ExposureQueryResult): string[] => [
  ...new Set(result.matches.map((match) => match.release)),
];

const csvCell = (value: string): string =>
  /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

/** CSV of the result table; the browser downloads these bytes, nothing else. */
export const exposureCsv = (rows: readonly ExposureRow[]): string =>
  [
    "environment,release,component_version,criticality,freshness",
    ...rows.map((row) =>
      [row.environment, row.release, row.componentVersion, row.criticality, row.freshness]
        .map(csvCell)
        .join(","),
    ),
  ].join("\n");

/** Recalled-release events from a change-event page, newest first. */
export const recallEvents = (events: readonly ChangeEvent[]): ChangeEvent[] =>
  events.filter((event) => event.kind === "release_recalled").toReversed();

/** Wave-order environment names from the same comma list the CLI takes. */
export const cohortNames = (raw: string): string[] => [
  ...new Set(
    raw
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name.length > 0),
  ),
];
