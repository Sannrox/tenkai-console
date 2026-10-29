import type {
  ChannelPage,
  EnvironmentInspectReport,
  EnvironmentListEntry,
  FleetEnvironmentRow,
  FleetStatusReport,
} from "../api/tenkai.gen";
import { planLabel } from "./maintenance";
import { holdLine } from "./model";

/**
 * Read-only configuration views (decision 4D). Fleet tables and the releases
 * matrix come from bulk routes; inspect-derived rows stay for the selected
 * environment's detail rail.
 */

export type Tone = "ok" | "warn" | "bad" | "muted";

const POSTURE_TONE: Record<string, Tone> = {
  current: "ok",
  behind: "warn",
  unhealthy: "bad",
  empty: "muted",
  held: "warn",
};

const HEALTH_TONE: Record<string, Tone> = {
  ok: "ok",
  error: "bad",
  unknown: "warn",
  "n/a": "muted",
};

/** One environments-table row from `v1/fleet/status` plus the environment list. */
export type FleetTableRow = {
  name: string;
  status: string;
  statusTone: Tone;
  release: string;
  health: string;
  healthTone: Tone;
  lastApply: string;
  drift: number;
};

const releaseLabel = (row: FleetEnvironmentRow): string =>
  row.subscription_count === 0 ? "none" : `${row.products_current}/${row.subscription_count}`;

export const fleetTableRows = (
  fleet: FleetStatusReport | undefined,
  list: EnvironmentListEntry[] | undefined,
): FleetTableRow[] => {
  const held = new Set(
    (list ?? []).filter((entry) => entry.delivery_held).map((entry) => entry.name),
  );
  return (fleet?.environments ?? [])
    .toSorted((left, right) => left.name.localeCompare(right.name))
    .map((row) => {
      const status = held.has(row.name) ? "held" : row.posture;
      return {
        name: row.name,
        status,
        statusTone: POSTURE_TONE[status] ?? "muted",
        release: releaseLabel(row),
        health: row.health_summary,
        healthTone: HEALTH_TONE[row.health_summary] ?? "muted",
        // Fleet status leaves plan state empty; "·" is unavailable, not "no apply".
        lastApply: row.latest_plan_state?.trim() || "·",
        drift: row.products_behind,
      };
    });
};

export type FleetAttention = {
  tone: "warn" | "bad";
  environment: string;
  detail: string;
  next: string;
};

/**
 * Fleet-scale attention from bulk posture only. Plan state is not on
 * `v1/fleet/status`; the selected environment's inspect rail is the source.
 */
export const fleetAttention = (rows: FleetEnvironmentRow[]): FleetAttention[] =>
  rows
    .filter((row) => row.posture === "unhealthy")
    .map((row) => ({
      tone: "bad" as const,
      environment: row.name,
      detail: `${row.health_summary} · ${row.posture}`,
      next: "Inspect",
    }))
    .toSorted((left, right) => left.environment.localeCompare(right.environment));

/** Channel head as the operator-facing version, dropping a `tenkai:release:` prefix. */
export const channelHeadLabel = (head: string): string => {
  const at = head.lastIndexOf("@");
  return at >= 0 ? head.slice(at + 1) : head;
};

export type ChannelMatrix = {
  channels: string[];
  products: string[];
  cell: (product: string, channel: string) => { version: string } | undefined;
};

/** Products by channels from the channel catalog. */
export const channelMatrix = (page: ChannelPage | undefined): ChannelMatrix => {
  const heads = new Map<string, string>();
  for (const item of page?.items ?? []) {
    heads.set(`${item.product}\0${item.name}`, channelHeadLabel(item.head));
  }
  const pairs = [...heads.keys()].map((key) => key.split("\0") as [string, string]);
  return {
    channels: [...new Set(pairs.map(([, channel]) => channel))].toSorted(),
    products: [...new Set(pairs.map(([product]) => product))].toSorted(),
    cell: (product, channel) => {
      const version = heads.get(`${product}\0${channel}`);
      return version === undefined ? undefined : { version };
    },
  };
};

export type EnvironmentRow = {
  name: string;
  description: string;
  channels: string[];
  deployed: number;
  subscribed: number;
  facts: string;
  lease: string;
  plan: string;
  hold: string | undefined;
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
      plan: planLabel(report),
      hold: report.delivery_hold ? holdLine(report.delivery_hold) : undefined,
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
