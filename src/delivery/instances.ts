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
};

const unboundLabel = (requirement: RequirementView): string => {
  const { provider } = requirement;
  if (provider.state === "ambiguous") {
    return `unbound: ${provider.products.join(", ")}`;
  }
  return requirement.optional ? "absent" : "unmet";
};

/** One row per required or optional contract: who is bound, and that instance's health. */
export const bindingRows = (
  report: EnvironmentDependencies,
  health: ReadonlyMap<string, InstanceHealth>,
): BindingRow[] =>
  report.products.flatMap((product) =>
    product.requirements.map((requirement) => {
      const instance = boundInstance(requirement);
      if (instance === undefined) {
        return {
          dependent: product.product,
          contract: requirement.contract,
          boundTo: unboundLabel(requirement),
          boundTone:
            requirement.provider.state === "ambiguous" || !requirement.optional ? "bad" : "muted",
          health: "n/a",
          healthTone: "muted" as const,
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
      };
    }),
  );
