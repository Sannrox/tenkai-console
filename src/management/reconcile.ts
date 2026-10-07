import type { EnvironmentStatus, TickReport } from "../api/tenkai.gen";

/**
 * One reconcile tick as the server reported it: a line per environment, in
 * the server's terms. Nothing is inferred; `busy` and `deferred` mean the
 * tick did not act on that environment this time.
 */

export type TickLine = { environment: string; tone: "ok" | "warn" | "bad"; text: string };

const line = (status: EnvironmentStatus): Pick<TickLine, "tone" | "text"> => {
  switch (status.state) {
    case "current":
      return { tone: "ok", text: "current" };
    case "applied":
      return { tone: "ok", text: `applied ${status.steps} steps, plan ${status.plan_id}` };
    case "awaiting_runtime":
      return { tone: "warn", text: `awaiting runtime, plan ${status.plan_id}` };
    case "awaiting_approval":
      return { tone: "warn", text: `awaiting approval, plan ${status.plan_id}` };
    case "failed":
      return { tone: "bad", text: `failed: ${status.error}` };
    case "deferred":
      return {
        tone: "warn",
        text: `deferred until ${new Date(status.retry_at).toLocaleTimeString()}`,
      };
    default:
      return { tone: "warn", text: "busy, skipped this tick" };
  }
};

export const tickLines = (report: TickReport): TickLine[] =>
  report.environments
    .map(({ environment, status }) => ({ environment, ...line(status) }))
    .toSorted((left, right) => left.environment.localeCompare(right.environment));

/** "Tick ran: 3 environments, 1 failed". */
export const tickSummary = (report: TickReport): string => {
  const failed = report.environments.filter(({ status }) => status.state === "failed").length;
  const count = report.environments.length;
  return `Tick ran: ${count} ${count === 1 ? "environment" : "environments"}${failed ? `, ${failed} failed` : ""}`;
};
