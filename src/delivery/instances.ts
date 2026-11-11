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

/** Reported instance health; missing on older inspect bodies is `n/a`. */
export const instanceHealth = (subscription: InstanceSubscription): InstanceHealth => {
  const health = subscription.health?.trim() ?? "";
  if (health === "ok") {
    return { label: "ok", tone: "ok" };
  }
  if (health === "error" || health === "unknown") {
    return { label: health, tone: "bad" };
  }
  if (health !== "") {
    return { label: health, tone: "warn" };
  }
  if ((subscription.error ?? "").trim() !== "") {
    return { label: "error", tone: "bad" };
  }
  return { label: "n/a", tone: "muted" };
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
