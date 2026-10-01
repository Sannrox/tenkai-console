import type {
  EnvironmentInspectReport,
  EnvironmentPlanSummary,
  EnvironmentSubscriptionView,
} from "../api/tenkai.gen";

/**
 * Delivery matrix model (decision 2B). Pure: built from inspect reports only,
 * so every state shown is a server state, never derived in the browser beyond
 * labeling and ordering.
 */

export type Tone = "ok" | "warn" | "bad" | "muted";

export type Cell = {
  version: string;
  tone: Tone;
  status: string;
  channel: string;
};

export type Column = {
  environment: string;
  /** Set when every subscription in the environment uses one channel. */
  channel: string | undefined;
};

export type Attention = {
  tone: "warn" | "bad";
  product: string | undefined;
  environment: string;
  detail: string;
  next: string;
};

const ACTIVE_PLAN = new Set(["computed", "running", "blocked"]);

const planStep = (plan: EnvironmentPlanSummary | null | undefined, product: string) =>
  plan && ACTIVE_PLAN.has(plan.state)
    ? plan.steps?.find((step) => step.product === product)
    : undefined;

const tone = (state: string): Tone =>
  (({ current: "ok", behind: "warn", config_stale: "warn", unhealthy: "bad", missing: "bad" })[
    state
  ] as Tone | undefined) ?? "muted";

/** One matrix cell: deployed version, its tone, and a short status line. */
export const cell = (
  subscription: EnvironmentSubscriptionView,
  plan: EnvironmentPlanSummary | null | undefined,
): Cell => {
  const step = planStep(plan, subscription.product);
  const base = {
    version: subscription.deployed ?? "none",
    tone: tone(subscription.state),
    channel: subscription.channel,
  };
  if (step && plan) {
    const verb = { computed: "plan ready", running: "rolling out", blocked: "blocked" }[plan.state];
    return { ...base, status: `${verb} → ${step.to}` };
  }
  const status: Record<string, string> = {
    current: "current",
    behind: `behind · head ${subscription.head}`,
    config_stale: "config changed",
    missing: "missing",
    unhealthy: subscription.error ? `unhealthy · ${subscription.error}` : "unhealthy",
    unknown: "health unknown",
  };
  return { ...base, status: status[subscription.state] ?? subscription.state };
};

export type Matrix = {
  columns: Column[];
  products: string[];
  cell: (product: string, environment: string) => Cell | undefined;
};

/** Products as rows, environments as columns ordered by name. */
export const matrix = (reports: EnvironmentInspectReport[]): Matrix => {
  const sorted = reports.toSorted((left, right) => left.name.localeCompare(right.name));
  const cells = new Map<string, Cell>();
  const products = new Set<string>();
  const columns = sorted.map((report) => {
    const channels = new Set(report.subscriptions.map((subscription) => subscription.channel));
    for (const subscription of report.subscriptions) {
      products.add(subscription.product);
      cells.set(`${subscription.product}\0${report.name}`, cell(subscription, report.latest_plan));
    }
    return {
      environment: report.name,
      channel: channels.size === 1 ? [...channels][0] : undefined,
    };
  });
  return {
    columns,
    products: [...products].toSorted(),
    cell: (product, environment) => cells.get(`${product}\0${environment}`),
  };
};

/** "api 1.14.2 → 1.16.0 +2 more", or the step count when steps were not returned. */
export const planSummary = (plan: EnvironmentPlanSummary): string => {
  const [first] = plan.steps ?? [];
  if (!first) {
    return `${plan.step_count} ${plan.step_count === 1 ? "step" : "steps"}`;
  }
  const more = plan.step_count - 1;
  return `${first.product} ${first.from ?? "none"} → ${first.to}${more > 0 ? ` +${more} more` : ""}`;
};

const RANK = { bad: 0, warn: 1 } as const;

/** What needs a person, most severe first, each with one next action. */
export const attention = (reports: EnvironmentInspectReport[]): Attention[] => {
  const items: Attention[] = [];
  for (const report of reports) {
    const plan = report.latest_plan;
    if (plan?.state === "failed") {
      items.push({
        tone: "bad",
        product: undefined,
        environment: report.name,
        detail: plan.status_detail || `failed: ${planSummary(plan)}`,
        next: "inspect failure",
      });
    } else if (plan?.state === "blocked") {
      items.push({
        tone: "warn",
        product: undefined,
        environment: report.name,
        detail: plan.status_detail || `blocked: ${planSummary(plan)}`,
        next: "review plan",
      });
    } else if (plan?.state === "computed") {
      items.push({
        tone: "warn",
        product: undefined,
        environment: report.name,
        detail: plan.status_detail || `ready: ${planSummary(plan)}`,
        next: "review plan",
      });
    }
    for (const subscription of report.subscriptions) {
      if (planStep(plan, subscription.product)) {
        continue;
      }
      const at = { product: subscription.product, environment: report.name };
      if (subscription.state === "unhealthy") {
        items.push({
          ...at,
          tone: "bad",
          detail: `${subscription.deployed ?? "none"} unhealthy${subscription.error ? `: ${subscription.error}` : ""}`,
          next: "roll back",
        });
      } else if (subscription.state === "missing") {
        items.push({
          ...at,
          tone: "bad",
          detail: `subscribed to ${subscription.channel}, nothing deployed`,
          next: "plan",
        });
      } else if (subscription.state === "behind") {
        items.push({
          ...at,
          tone: "warn",
          detail: `${subscription.deployed} behind, head ${subscription.head}`,
          next: "plan",
        });
      } else if (subscription.state === "config_stale") {
        items.push({
          ...at,
          tone: "warn",
          detail: "configuration changed since deploy",
          next: "plan",
        });
      }
    }
  }
  return items.toSorted(
    (left, right) =>
      RANK[left.tone] - RANK[right.tone] ||
      left.environment.localeCompare(right.environment) ||
      (left.product ?? "").localeCompare(right.product ?? ""),
  );
};
