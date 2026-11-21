import type {
  ChangeEvent,
  ChannelPage,
  EnvironmentInspectReport,
  EnvironmentListEntry,
  FleetEnvironmentRow,
  FleetStatusReport,
  RuntimeRunner,
} from "../api/tenkai.gen";
import { planLabel } from "./maintenance";
import { holdLine } from "./model";
import { shortId } from "./runners";

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
  /** Environment owner contact, or `·` when none is set. */
  owner: string;
  /** Server says: no owner and no webhook endpoint of its own. Absent reads false. */
  unrouted: boolean;
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
        owner: row.owner?.trim() || "·",
        unrouted: row.unrouted === true,
      };
    });
};

export const ATTENTION_KINDS = ["environment", "finding", "runner", "release", "event"] as const;

export type AttentionKind = (typeof ATTENTION_KINDS)[number];

export type FleetAttention = {
  tone: "warn" | "bad";
  kind: AttentionKind;
  key: string;
  title: string;
  detail: string;
  next: string;
  environment?: string;
  runnerId?: string;
  advisory?: string;
  release?: string;
};

export type AttentionSources = {
  environments?: readonly FleetEnvironmentRow[];
  runners?: readonly RuntimeRunner[];
  events?: readonly ChangeEvent[];
};

const RANK = { bad: 0, warn: 1 } as const;

/**
 * Fleet-scale attention from bulk reads: posture, products behind, open
 * findings, runners with no heartbeat, recall events, and target failures.
 * Plan approvals, drift and certificate warnings stay off this list.
 */
export const fleetAttention = (source: AttentionSources): FleetAttention[] => {
  const items: FleetAttention[] = [];
  for (const row of source.environments ?? []) {
    if (row.posture === "unhealthy") {
      items.push({
        tone: "bad",
        kind: "environment",
        key: `env:${row.name}:unhealthy`,
        title: row.name,
        detail: `${row.health_summary} · ${row.posture}`,
        next: "Inspect",
        environment: row.name,
      });
    }
    if (row.products_behind > 0) {
      items.push({
        tone: "warn",
        kind: "environment",
        key: `env:${row.name}:behind`,
        title: row.name,
        detail: `${row.products_behind} behind`,
        next: "Inspect",
        environment: row.name,
      });
    }
    for (const exposure of row.open_exposures ?? []) {
      items.push({
        tone: exposure.severity === "critical" || exposure.severity === "high" ? "bad" : "warn",
        kind: "finding",
        key: `finding:${row.name}:${exposure.advisory_id}:${exposure.release}`,
        title: exposure.advisory_id,
        detail: `${row.name} · ${exposure.release} · ${exposure.severity}`,
        next: "Inspect",
        environment: row.name,
        advisory: exposure.advisory_id,
        release: exposure.release,
      });
    }
  }
  for (const runner of source.runners ?? []) {
    if (runner.state === "revoked") {
      continue;
    }
    const heartbeat = runner.instances.some((instance) => instance.last_heartbeat_at !== undefined);
    if (!heartbeat) {
      items.push({
        tone: "bad",
        kind: "runner",
        key: `runner:${runner.id}`,
        title: shortId(runner.id),
        detail: `${runner.environment} · no heartbeat`,
        next: "Inspect",
        environment: runner.environment,
        runnerId: runner.id,
      });
    }
  }
  const recalled = new Set<string>();
  const failed = new Set<string>();
  for (const event of [...(source.events ?? [])].toReversed()) {
    if (event.kind === "release_recalled") {
      if (recalled.has(event.resource)) {
        continue;
      }
      recalled.add(event.resource);
      items.push({
        tone: "warn",
        kind: "release",
        key: `recall:${event.resource}`,
        title: event.resource,
        detail: event.environment ? `${event.environment} · recalled` : "recalled",
        next: "Follow through",
        ...(event.environment === undefined ? {} : { environment: event.environment }),
        release: event.resource,
      });
    } else if (event.kind === "target_failed") {
      const id = `${event.environment ?? ""}:${event.resource}`;
      if (failed.has(id)) {
        continue;
      }
      failed.add(id);
      items.push({
        tone: "bad",
        kind: "event",
        key: `event:${id}`,
        title: event.resource,
        detail: event.environment ? `${event.environment} · failed` : "failed",
        next: "Inspect",
        ...(event.environment === undefined ? {} : { environment: event.environment }),
      });
    }
  }
  return items.toSorted(
    (left, right) =>
      RANK[left.tone] - RANK[right.tone] ||
      left.title.localeCompare(right.title) ||
      left.key.localeCompare(right.key),
  );
};

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
