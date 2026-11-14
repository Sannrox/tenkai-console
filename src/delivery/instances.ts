import type { EnvironmentSubscriptionView } from "../api/tenkai.gen";
import type { EnvironmentDependencies, RequirementView } from "./dependencies";

/**
 * Inspect subscription fields this view reads. The v0.6.0 pin omits `instance`
 * and `health`; newer servers send them on the same inspect body.
 */
export type InstanceSubscription = EnvironmentSubscriptionView & {
  instance?: string;
  health?: string | null;
};

/** Instance this subscription names. Equals the product when unnamed. */
export const instanceName = (subscription: InstanceSubscription): string => {
  const instance = subscription.instance?.trim() ?? "";
  return instance === "" ? subscription.product : instance;
};

export type HealthTone = "ok" | "warn" | "bad" | "muted";

export type InstanceHealth = { label: string; tone: HealthTone };

/**
 * Reported instance health; missing on older bodies is `n/a`.
 * `unhealthy` is the serving label for a failing observation; a stale
 * observation is already `unknown` on the server, never healthy.
 */
const reportedHealth = (
  reported: string | null | undefined,
  error: string | null | undefined,
): InstanceHealth => {
  const health = reported?.trim() ?? "";
  if (health === "ok" || health === "healthy") {
    return { label: health, tone: "ok" };
  }
  if (health === "unhealthy") {
    return { label: "failing", tone: "bad" };
  }
  if (health === "error" || health === "unknown") {
    return { label: health, tone: "bad" };
  }
  if (health !== "") {
    return { label: health, tone: "warn" };
  }
  if ((error ?? "").trim() !== "") {
    return { label: "error", tone: "bad" };
  }
  return { label: "n/a", tone: "muted" };
};

export const instanceHealth = (subscription: InstanceSubscription): InstanceHealth =>
  reportedHealth(subscription.health, subscription.error);

/** One check from the latest health observation, as status reports it. */
export type HealthCheck = { name: string; state: string; message?: string };

export type HealthCheckView = { name: string; state: string; message: string; tone: HealthTone };

export type InstanceHealthView = InstanceHealth & { checks: HealthCheckView[] };

// Check states, mildest first. A state this build does not know reads as a warning.
const CHECK_STATES = ["healthy", "repairing", "warning", "failing"];
const checkRank = (state: string): number => {
  const rank = CHECK_STATES.indexOf(state);
  return rank < 0 ? 2 : rank;
};
const CHECK_TONE: HealthTone[] = ["ok", "warn", "warn", "bad"];
const BASE_RANK: Record<HealthTone, number> = { muted: -1, ok: 0, warn: 2, bad: 3 };

/**
 * Instance state from a status row: the reported health, raised to the worst
 * reported check (a `truncated` output is one more warning). `unknown` stays
 * unknown; the server sends no checks for a stale observation.
 */
export const instanceHealthView = (row: {
  health?: string | null | undefined;
  error?: string | null | undefined;
  health_checks?: readonly HealthCheck[] | undefined;
}): InstanceHealthView => {
  const checks = (row.health_checks ?? [])
    .map((check) => ({
      name: check.name,
      state: check.state,
      message: check.message?.trim() ?? "",
      tone: CHECK_TONE[checkRank(check.state)] ?? "warn",
    }))
    .toSorted(
      (left, right) =>
        checkRank(right.state) - checkRank(left.state) || left.name.localeCompare(right.name),
    );
  const base = reportedHealth(row.health, row.error);
  const worst = checks[0];
  // `unknown` and `failing` are `bad`, which no check outranks.
  const raise = worst !== undefined && checkRank(worst.state) > BASE_RANK[base.tone];
  return raise ? { label: worst.state, tone: worst.tone, checks } : { ...base, checks };
};

type HealthRow = Parameters<typeof instanceHealthView>[0] & { product: string; instance?: string };

/**
 * Each subscription with its status row and health. Status carries the live
 * checks; inspect health stands in when status is not loaded or omits the row.
 */
export const withHealth = <Row extends HealthRow>(
  subscriptions: readonly InstanceSubscription[],
  rows: readonly Row[] | undefined,
) => {
  const byInstance = new Map(rows?.map((row) => [row.instance?.trim() || row.product, row]));
  return subscriptions.map((subscription) => {
    const instance = instanceName(subscription);
    const row = byInstance.get(instance);
    return { subscription, instance, row, health: instanceHealthView(row ?? subscription) };
  });
};

const TONE_ORDER: HealthTone[] = ["bad", "warn", "ok", "muted"];

/**
 * Environment roll-up of instance states, worst first: `1 failing · 2 unknown
 * · 3 healthy`. Unknown is counted on its own, never as healthy.
 */
export const healthRollup = (healths: readonly InstanceHealth[]): InstanceHealth => {
  const counts = new Map<string, InstanceHealth & { count: number }>();
  for (const health of healths) {
    const seen = counts.get(health.label);
    counts.set(health.label, { ...health, count: (seen?.count ?? 0) + 1 });
  }
  const entries = [...counts.values()].toSorted(
    (left, right) =>
      TONE_ORDER.indexOf(left.tone) - TONE_ORDER.indexOf(right.tone) ||
      left.label.localeCompare(right.label),
  );
  const first = entries[0];
  if (first === undefined) {
    return { label: "none", tone: "muted" };
  }
  return {
    label: entries.map((entry) => `${entry.count} ${entry.label}`).join(" · "),
    tone: first.tone,
  };
};

export const healthByInstance = (
  subscriptions: InstanceSubscription[],
): ReadonlyMap<string, InstanceHealth> =>
  new Map(
    subscriptions.map((subscription) => [instanceName(subscription), instanceHealth(subscription)]),
  );

const boundInstance = (requirement: RequirementView): string | undefined => {
  const { provider } = requirement;
  if (provider.state !== "unique") {
    return undefined;
  }
  const instance = provider.instance?.trim() ?? "";
  return instance === "" ? provider.product : instance;
};

export type BindingRow = {
  dependent: string;
  contract: string;
  boundTo: string;
  boundTone: HealthTone;
  health: string;
  healthTone: HealthTone;
  grant: "granted" | "none";
  providerIdentity: string;
  callerIdentity: string;
};

export type GrantRow = {
  instance: string;
  caller: string;
  contract: string;
  binding: string;
};

const identityUri = (environment: string, instance: string): string =>
  `tenkai://${environment}/${instance}`;

const unboundLabel = (requirement: RequirementView): string => {
  const { provider } = requirement;
  if (provider.state === "ambiguous") {
    return `unbound: ${provider.products.join(", ")}`;
  }
  return requirement.optional ? "absent" : "unmet";
};

const grantFields = (
  environment: string,
  dependent: string,
  instance: string | undefined,
  granted: boolean,
): Pick<BindingRow, "grant" | "providerIdentity" | "callerIdentity"> => {
  if (!granted || instance === undefined) {
    return { grant: "none", providerIdentity: "none", callerIdentity: "none" };
  }
  return {
    grant: "granted",
    providerIdentity: identityUri(environment, instance),
    callerIdentity: identityUri(environment, dependent),
  };
};

/** One row per required or optional contract: who is bound, and that instance's health. */
export const bindingRows = (
  report: EnvironmentDependencies,
  health: ReadonlyMap<string, InstanceHealth>,
): BindingRow[] =>
  report.products.flatMap((product) =>
    product.requirements.map((requirement) => {
      const instance = boundInstance(requirement);
      const granted =
        requirement.provider.state === "unique" && requirement.provider.granted === true;
      const grant = grantFields(report.environment, product.product, instance, granted);
      if (instance === undefined) {
        return {
          dependent: product.product,
          contract: requirement.contract,
          boundTo: unboundLabel(requirement),
          boundTone:
            requirement.provider.state === "ambiguous" || !requirement.optional ? "bad" : "muted",
          health: "n/a",
          healthTone: "muted" as const,
          ...grant,
        };
      }
      const reported = health.get(instance);
      return {
        dependent: product.product,
        contract: requirement.contract,
        boundTo: instance,
        boundTone: "ok" as const,
        health: reported?.label ?? "n/a",
        healthTone: reported?.tone ?? "muted",
        ...grant,
      };
    }),
  );

/** Granted callers per provider instance, each tied to the binding that names them. */
export const grantRows = (report: EnvironmentDependencies): GrantRow[] => {
  const rows: GrantRow[] = [];
  for (const product of report.products) {
    for (const requirement of product.requirements) {
      if (requirement.provider.state !== "unique" || requirement.provider.granted !== true) {
        continue;
      }
      const instance = boundInstance(requirement);
      if (instance === undefined) {
        continue;
      }
      rows.push({
        instance,
        caller: identityUri(report.environment, product.product),
        contract: requirement.contract,
        binding: `${product.product} → ${instance}`,
      });
    }
  }
  return rows;
};
