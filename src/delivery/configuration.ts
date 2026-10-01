import type { EnvironmentInspectReport } from "../api/tenkai.gen";

/**
 * Read-only configuration views (decision 4D) derived from inspect reports:
 * environment summaries for the Environments tab and channel heads for the
 * Releases tab. Channels have no list route; every head shown here is one a
 * subscribed environment reports.
 */

export type EnvironmentRow = {
  name: string;
  description: string;
  channels: string[];
  deployed: number;
  subscribed: number;
  facts: string;
  lease: string;
  plan: string;
};

export const environmentRows = (reports: EnvironmentInspectReport[]): EnvironmentRow[] =>
  reports
    .toSorted((left, right) => left.name.localeCompare(right.name))
    .map((report) => ({
      name: report.name,
      description: report.description,
      channels: [
        ...new Set(report.subscriptions.map((subscription) => subscription.channel)),
      ].toSorted(),
      deployed: report.subscriptions.filter((subscription) => subscription.deployed).length,
      subscribed: report.subscriptions.length,
      facts: Object.entries(report.facts)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => `${key}=${value}`)
        .join(" · "),
      lease: report.lease.held
        ? `held · generation ${report.lease.generation ?? 0}${report.lease.owner ? ` · ${report.lease.owner}` : ""}`
        : "free",
      plan: report.latest_plan?.state ?? "none",
    }));

export type ChannelTable = {
  channels: string[];
  products: string[];
  head: (product: string, channel: string) => string | undefined;
  subscribers: (product: string, channel: string) => string[];
};

/** Products by channels: the head each channel points to, and who follows it. */
export const channelTable = (reports: EnvironmentInspectReport[]): ChannelTable => {
  const heads = new Map<string, string>();
  const followers = new Map<string, string[]>();
  for (const report of reports) {
    for (const subscription of report.subscriptions) {
      const key = `${subscription.product}\0${subscription.channel}`;
      heads.set(key, subscription.head);
      followers.set(key, [...(followers.get(key) ?? []), report.name].toSorted());
    }
  }
  const pairs = [...heads.keys()].map((key) => key.split("\0") as [string, string]);
  return {
    channels: [...new Set(pairs.map(([, channel]) => channel))].toSorted(),
    products: [...new Set(pairs.map(([product]) => product))].toSorted(),
    head: (product, channel) => heads.get(`${product}\0${channel}`),
    subscribers: (product, channel) => followers.get(`${product}\0${channel}`) ?? [],
  };
};
