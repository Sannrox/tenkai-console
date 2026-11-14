import type { WebhookDelivery } from "./owners";

// Delivery failures by the configuration that routed them (Tenkai #1291).
// Each delivery names its sources: the environment, the product, or both when
// they share the URL. The console groups by the full set and never splits a
// shared delivery or guesses a source the server did not name.

export type Source = { kind: string; name: string };

/** One source as shown: its owner contact, `none`, or `·` when unknown here. */
export type SourceLine = Source & { owner: string };

export type FailureGroup = {
  key: string;
  /** Empty when the server named no source: unattributed. */
  sources: SourceLine[];
  failures: number;
  urls: string[];
};

/** Tried and not delivered: the server's own failing rule. */
export const failing = (delivery: WebhookDelivery): boolean =>
  delivery.delivered_at === undefined && delivery.state !== "delivered" && delivery.attempts > 0;

/**
 * True when the list shows the server records sources. Older servers send
 * none on any row; their failures are unknown, not unattributed.
 */
export const attributed = (deliveries: WebhookDelivery[]): boolean =>
  deliveries.some((delivery) => (delivery.sources ?? []).length > 0);

const sourceKey = ({ kind, name }: Source): string => `${kind}\0${name}`;

/**
 * Failing deliveries grouped by their full source set, most failures first and
 * unattributed last. A delivery listed twice (two products' lists) counts once.
 * `ownerOf` answers the owner contact of a source, or undefined when unknown.
 */
export const failureGroups = (
  deliveries: WebhookDelivery[],
  ownerOf: (source: Source) => string | undefined,
): FailureGroup[] => {
  const groups = new Map<string, FailureGroup>();
  const seen = new Set<string>();
  for (const delivery of deliveries) {
    if (!failing(delivery) || seen.has(delivery.id)) {
      continue;
    }
    seen.add(delivery.id);
    const sources = [
      ...new Map((delivery.sources ?? []).map((source) => [sourceKey(source), source])).values(),
    ].toSorted((left, right) => sourceKey(left).localeCompare(sourceKey(right)));
    const key = sources.map(sourceKey).join("\n");
    const group = groups.get(key) ?? {
      key,
      sources: sources.map((source) => ({
        kind: source.kind,
        name: source.name,
        owner: ownerOf(source) ?? "·",
      })),
      failures: 0,
      urls: [],
    };
    group.failures += 1;
    const url = delivery.url.trim() || "none";
    if (!group.urls.includes(url)) {
      group.urls.push(url);
    }
    groups.set(key, group);
  }
  return [...groups.values()].toSorted(
    (left, right) =>
      Number(left.sources.length === 0) - Number(right.sources.length === 0) ||
      right.failures - left.failures ||
      left.key.localeCompare(right.key),
  );
};
