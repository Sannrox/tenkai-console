import { type } from "arktype";
import type {
  CompatibilityEvidence2 as CompatibilityObservation,
  CompatibilityFailure,
  CompatibilityReport,
} from "../api/tenkai.gen";

/**
 * Software compatibility (Tenkai #571) for the release panel: a release's
 * report per environment, grouped for reading, and the observation an
 * environment owner records as evidence. The browser checks only the shape;
 * the server binds the observation to the release and environment.
 */

/** What a failure is about, in the order the panel lists them. */
export const KINDS = [
  "evidence",
  "release",
  "component",
  "contract",
  "capability",
  "fact",
  "schema",
] as const;
export type FailureKind = (typeof KINDS)[number];

/** One failure as the panel shows it: its subject, when it names one. */
export type ShownFailure = { reason: CompatibilityFailure["reason"]; subject?: string };

const kindOf = (failure: CompatibilityFailure): FailureKind => {
  if ("component" in failure) {
    return "component";
  }
  if ("contract" in failure) {
    return "contract";
  }
  if ("capability" in failure) {
    return "capability";
  }
  if ("fact" in failure) {
    return "fact";
  }
  switch (failure.reason) {
    case "release_binding":
    case "environment_binding":
      return "release";
    case "unsupported_schema":
    case "migration_state":
      return "schema";
    default:
      return "evidence";
  }
};

const subjectOf = (failure: CompatibilityFailure): string | undefined =>
  "component" in failure
    ? failure.component
    : "contract" in failure
      ? failure.contract
      : "capability" in failure
        ? failure.capability
        : "fact" in failure
          ? failure.fact
          : undefined;

/** Failures grouped by kind, in [`KINDS`] order, each group by subject. */
export const groupFailures = (
  failures: CompatibilityFailure[],
): Array<{ kind: FailureKind; failures: ShownFailure[] }> =>
  KINDS.map((kind) => ({
    kind,
    failures: failures
      .filter((failure) => kindOf(failure) === kind)
      .map((failure) => {
        const subject = subjectOf(failure);
        return subject === undefined
          ? { reason: failure.reason }
          : { reason: failure.reason, subject };
      })
      .toSorted((a, b) => (a.subject ?? "").localeCompare(b.subject ?? "")),
  })).filter((group) => group.failures.length > 0);

/** A release's standing in one environment. */
export type Standing = "compatible" | "blocked" | "no-profile";

/** `null` is a release without a compatibility profile: nothing to check. */
export const standing = (report: CompatibilityReport | null): Standing =>
  report === null ? "no-profile" : report.failures.length === 0 ? "compatible" : "blocked";

/** Operator copy: drop the `_contract` suffix and use spaces. */
export const failureLabel = (reason: CompatibilityFailure["reason"]): string =>
  reason.replace(/_contract$/, "").replaceAll("_", " ");

/** One visible failure line, subject first when the API named one. */
export const failureLines = (failures: CompatibilityFailure[]): string[] =>
  failures.map((failure) => {
    const subject = subjectOf(failure);
    const label = failureLabel(failure.reason);
    return subject ? `${subject} ${label}` : label;
  });

const SatisfiedBy = type("Record<string, string>");

/**
 * Additive `satisfied_by` from Tenkai #1005. The pinned contract omits it;
 * a missing or malformed map reads as empty.
 */
export const satisfiedBy = (report: CompatibilityReport): Record<string, string> => {
  const extra = (report as CompatibilityReport & { satisfied_by?: unknown }).satisfied_by;
  if (extra === undefined) {
    return {};
  }
  const value = SatisfiedBy(extra);
  return value instanceof type.errors ? {} : value;
};

export const matchedLine = (report: CompatibilityReport): string =>
  Object.values(satisfiedBy(report)).join(" · ") || "none";

export type CompatibilityEdge = {
  contract: string;
  status: string;
  statusTone: "ok" | "bad";
  providedBy: string;
};

/** Required contracts: matched providers, then contract failures. */
export const edgeRows = (report: CompatibilityReport): CompatibilityEdge[] => {
  const rows = new Map<string, CompatibilityEdge>();
  for (const [contract, provider] of Object.entries(satisfiedBy(report))) {
    rows.set(contract, {
      contract,
      status: "matched",
      statusTone: "ok",
      providedBy: provider,
    });
  }
  for (const item of report.failures) {
    if (!("contract" in item)) {
      continue;
    }
    rows.set(item.contract, {
      contract: item.contract,
      status: failureLabel(item.reason),
      statusTone: "bad",
      providedBy: "none",
    });
  }
  return [...rows.values()];
};

const Observation = type({
  version: "number",
  environment: "string",
  release_digest: "string",
  observed_at_ms: "number",
  components: "Record<string, object>",
  contracts: "Record<string, string>",
  capabilities: "string[]",
  "schema_version?": "number | null",
  migration: "'stable' | 'pending'",
});

/**
 * A pasted observation for `environment`, or why it cannot be sent. Sent as
 * parsed; its environment must be the one it is recorded for.
 */
export const parseObservation = (
  text: string,
  environment: string,
): CompatibilityObservation | string => {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return "The evidence must be an observation JSON document.";
  }
  const observation = Observation(value);
  if (observation instanceof type.errors) {
    return `Evidence: ${observation.summary}`;
  }
  if (observation.environment !== environment) {
    return `The evidence is for ${observation.environment}, not ${environment}.`;
  }
  return value as CompatibilityObservation;
};
