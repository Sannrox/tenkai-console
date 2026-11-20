import { ApiError } from "../api/http";
import type { EnvironmentPlanSummary } from "../api/tenkai.gen";
import type { Outcome } from "../management/use-management";
import type { LiveWorkload, StatusRow } from "./identity";
import { instanceName, type InstanceSubscription } from "./instances";

/**
 * Unmanaged live workloads and the adopt action (Sannrox/tenkai#1082).
 * Status lists them; POST adopt records a matching pin without mutating the
 * target. The browser never compares live to desired: differences come from
 * the server's refusal.
 */

export const COPY = {
  recording: "Adoption records the matching workload as deployed. It does not change the target.",
  none: "none",
  differs: "Live differs from the chosen release.",
  pending: "Adoption recorded; the plan needs signed approval.",
  adopted: "Recorded as deployed.",
  forbidden: "Not permitted.",
  unavailable: "This server cannot adopt a live workload.",
  already: "Already recorded as deployed.",
  recalled: "That release is recalled.",
  missing: "That product is not subscribed.",
  refused: "Adoption refused.",
  unknown: "No answer from the server; the outcome is unknown until the next inspect.",
} as const;

const ACTIVE_PLAN = new Set(["computed", "running", "blocked"]);

/** Live workloads no recorded instance owns. Omitted rows are an older server. */
export const unmanagedWorkloads = (rows: readonly StatusRow[]): LiveWorkload[] =>
  rows.flatMap((row) => (row.unmanaged === undefined ? [] : [row.unmanaged]));

/** Subscriptions that are not the live unmanaged set, so they never read as health. */
export const withoutUnmanaged = (
  subscriptions: readonly InstanceSubscription[],
  unmanaged: readonly LiveWorkload[],
): readonly InstanceSubscription[] => {
  if (unmanaged.length === 0) {
    return subscriptions;
  }
  const names = new Set(unmanaged.map((workload) => workload.name));
  return subscriptions.filter((subscription) => !names.has(instanceName(subscription)));
};

/** Catalog pin `product@version`; empty or incomplete text is not a release. */
export const adoptRelease = (text: string): string | undefined => {
  const release = text.trim();
  const at = release.indexOf("@");
  if (at <= 0 || at === release.length - 1 || release.includes(" ")) {
    return undefined;
  }
  return release;
};

const adoptStep = (plan: EnvironmentPlanSummary | null | undefined) =>
  plan?.steps?.find((step) => step.action === "adopt");

/** Computed, running, or blocked plan that records an adoption. */
export const pendingAdopt = (plan: EnvironmentPlanSummary | null | undefined): boolean =>
  Boolean(plan && ACTIVE_PLAN.has(plan.state) && adoptStep(plan));

/** Latest plan already recorded an adoption. */
export const recordedAdopt = (plan: EnvironmentPlanSummary | null | undefined): boolean =>
  plan?.state === "succeeded" && Boolean(adoptStep(plan));

export type AdoptGate =
  | "differs"
  | "forbidden"
  | "unavailable"
  | "already"
  | "recalled"
  | "missing"
  | "refused"
  | "unknown";

/** Map an adopt refusal to fixed copy; never the server's gate text. */
export const adoptGate = (error: unknown): AdoptGate => {
  if (!(error instanceof ApiError) || error.status >= 500) {
    return "unknown";
  }
  if (error.status === 403) {
    return "forbidden";
  }
  if (error.status === 404 || error.status === 405) {
    return "unavailable";
  }
  if (error.message.includes("adopt refused") || error.message.includes("live differs")) {
    return "differs";
  }
  if (error.message.includes("already recorded as deployed")) {
    return "already";
  }
  if (error.message.includes("cannot adopt recalled")) {
    return "recalled";
  }
  if (error.message.includes("is not subscribed")) {
    return "missing";
  }
  return "refused";
};

/**
 * Changed fields the server listed in an adopt refusal.
 * `adopt refused: live differs from api@1.0.0 (Service/api ports, Deployment/api image)`.
 */
export const differenceFields = (error: unknown): string[] => {
  if (!(error instanceof ApiError)) {
    return [];
  }
  const listed = /\(([^)]+)\)\s*$/.exec(error.message)?.[1];
  if (listed === undefined) {
    return [];
  }
  return listed
    .split(",")
    .map((field) => field.trim())
    .filter((field) => field !== "");
};

export const adoptOutcome = (error: unknown): Outcome => {
  if (error === undefined) {
    return { tone: "ok", text: COPY.pending };
  }
  const gate = adoptGate(error);
  return {
    tone: gate === "unknown" ? "unknown" : "bad",
    text: COPY[gate],
  };
};

/** Show the adopt form when unmanaged candidates exist and the caller may manage. */
export const showAdopt = (opts: {
  candidates: number;
  permitted: boolean;
  pending: boolean;
  gate: AdoptGate | undefined;
}): boolean =>
  opts.candidates > 0 &&
  opts.permitted &&
  !opts.pending &&
  opts.gate !== "forbidden" &&
  opts.gate !== "unavailable" &&
  opts.gate !== "already";

/** Arm Adopt only for a chosen pin, never while live still differs. */
export const offerAdopt = (
  opts: Parameters<typeof showAdopt>[0] & { release: string | undefined },
): boolean => showAdopt(opts) && opts.release !== undefined && opts.gate !== "differs";
