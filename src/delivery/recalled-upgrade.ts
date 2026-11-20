import { ApiError } from "../api/http";
import type { MatchedExposure } from "../api/tenkai.gen";
import type { Outcome } from "../management/use-management";
import { instanceName, type InstanceSubscription } from "./instances";
import type { RecallView } from "./recall";

/**
 * Pending-fix rows and admit copy for an advisory-recalled channel head
 * (Sannrox/tenkai#1068). The browser never compares blocking sets: it shows
 * the feed's advisories and sends `recalled_upgrade_reason` on plan.
 */

export const COPY = {
  health: "Health recall; no lower-exposure upgrade.",
  operator: "This recall is not an advisory.",
  equal: "Exposure is not lower.",
  forbidden: "Not permitted.",
  unavailable: "This server cannot admit a recalled upgrade.",
  unevaluable: "Exposure cannot be compared.",
  refused: "Admission refused.",
  unknown: "No answer from the server; the outcome is unknown until the next inspect.",
  admitted: "Upgrade admitted onto the recalled release.",
  none: "none",
} as const;

/** Catalog release id `product@version` as recall and the feed name it. */
export const releaseSpec = (product: string, version: string): string =>
  version.includes("@") ? version : `${product}@${version}`;

export type PendingFix = {
  instance: string;
  current: string;
  target: string;
};

/** Behind instances that still have a deployed pin and a channel head. */
export const pendingFixes = (subscriptions: readonly InstanceSubscription[]): PendingFix[] =>
  subscriptions.flatMap((subscription) => {
    const deployed = subscription.deployed?.trim() ?? "";
    if (subscription.state !== "behind" || deployed === "" || subscription.head.trim() === "") {
      return [];
    }
    return [
      {
        instance: instanceName(subscription),
        current: releaseSpec(subscription.product, deployed),
        target: releaseSpec(subscription.product, subscription.head),
      },
    ];
  });

/**
 * Promotion-policy / health recalls. Operator and advisory claims look the
 * same on GET recall; the plan route refuses unbound ones.
 */
export const isHealthRecall = (view: RecallView): boolean =>
  view.policy_id !== undefined ||
  view.healthy_share !== undefined ||
  view.failing_share !== undefined;

/** Feed advisories named for one catalog release, sorted, de-duplicated. */
export const advisoriesFor = (matches: readonly MatchedExposure[], release: string): string[] =>
  [
    ...new Set(
      matches
        .filter(
          (match) => match.release === release || match.release_id === `tenkai:release:${release}`,
        )
        .map((match) => match.advisory_id),
    ),
  ].toSorted();

export const exposureLine = (ids: readonly string[]): string =>
  ids.length === 0 ? COPY.none : ids.join(" · ");

export type UpgradeGate =
  | "equal"
  | "operator"
  | "forbidden"
  | "unavailable"
  | "unevaluable"
  | "refused"
  | "unknown";

const GATE = {
  equal: "recalled_upgrade_not_lower",
  operator: "recalled_upgrade_unbound",
  unevaluable: "recalled_upgrade_unevaluable",
} as const;

/** Map a plan refusal to fixed copy; never the server's gate name. */
export const upgradeGate = (error: unknown): UpgradeGate => {
  if (!(error instanceof ApiError) || error.status >= 500) {
    return "unknown";
  }
  if (error.status === 403) {
    return "forbidden";
  }
  if (error.status === 404 || error.status === 405) {
    return "unavailable";
  }
  if (error.message.includes(GATE.equal)) {
    return "equal";
  }
  if (error.message.includes(GATE.operator)) {
    return "operator";
  }
  if (error.message.includes(GATE.unevaluable)) {
    return "unevaluable";
  }
  return "refused";
};

export const upgradeOutcome = (error: unknown): Outcome => {
  if (error === undefined) {
    return { tone: "ok", text: COPY.admitted };
  }
  const gate = upgradeGate(error);
  return {
    tone: gate === "unknown" ? "unknown" : "bad",
    text: COPY[gate],
  };
};

/** Offer the admit control only for a non-health recall the caller may manage. */
export const offerAdmit = (opts: {
  recalled: boolean;
  health: boolean;
  permitted: boolean;
  gate: UpgradeGate | undefined;
}): boolean =>
  opts.recalled &&
  !opts.health &&
  opts.permitted &&
  opts.gate !== "equal" &&
  opts.gate !== "operator" &&
  opts.gate !== "forbidden";
