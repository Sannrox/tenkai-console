import { type } from "arktype";
import { ApiError } from "../api/http";
import { type AttemptCause, parseCause } from "./history";

// `POST /v1/plans/{id}/apply?steps=true` (Tenkai #1076). Step results,
// including `stale_target` (Tenkai #1272), are validated here rather than
// trusted as a generated type; `ApplyFailedBody` is not in the contract.
//
// Reuse decision
// Job: turn one apply response into per-step rows, filling remaining planned
// steps as not run, and linking each recorded attempt.
// Verdict: Generalize
// Concept: arktype extra-field overlay as in `history.ts`; parseCause from
// history; plan-page result status; environments search `{ environment,
// instance }` as the history filter from #112. `ApiError.body` keeps the
// parsed JSON so a 422 `ApplyFailedBody` still has steps.
// Edge: omitted or empty steps after asking is unavailable; 403 is no
// access; pin stays; not-run is a console merge of inspect plan.steps by
// product/instance/action/to, never a server status. Admission may report
// only the blocked step.
// Searched: ManagementLifecycleResult, ApplyFailedBody, plan-page mutation,
// environment-history table, historyPath. Rejected: pin bump; inventing
// not_run on the wire; a second apply result screen.

const ApplyStepBody = type({
  product: "string",
  instance: "string",
  action: "string",
  status: "string",
  to_version: "string",
  "detail?": "string",
  "detail_truncated?": "boolean",
  "restored_version?": "string",
  "attempt_id?": "string",
  "stale_target?": { kind: "string", name: "string", "+": "delete" },
  "+": "delete",
});

export type ApplyStep = typeof ApplyStepBody.infer & {
  cause?: AttemptCause;
};

export type ApplyRow = ApplyStep;

export type PlanStepRef = {
  product: string;
  action: string;
  to: string;
  instance?: unknown;
};

export type ApplyView = {
  ok: boolean;
  text: string;
  rows?: ApplyRow[];
  detail?: "unavailable" | "forbidden";
};

export const APPLY_COPY = {
  unavailable: "detail is unavailable",
  forbidden: "No access",
  cut: "cut",
  none: "none",
  notRun: "not run",
} as const;

/** Apply path that asks for per-step results; older servers ignore the query. */
export const applyPath = (planId: string): string =>
  `v1/plans/${encodeURIComponent(planId)}/apply?steps=true`;

const withCause = (step: typeof ApplyStepBody.infer, raw: unknown): ApplyStep => {
  if (typeof raw !== "object" || raw === null || !("cause" in raw)) {
    return step;
  }
  const cause = parseCause(raw.cause);
  return cause === undefined ? step : { ...step, cause };
};

/** Parse apply steps; `undefined` when omitted, empty, or not this contract. */
export const parseApplySteps = (raw: unknown): ApplyStep[] | undefined => {
  if (typeof raw !== "object" || raw === null || !("steps" in raw)) {
    return undefined;
  }
  const source = raw.steps;
  if (!Array.isArray(source) || source.length === 0) {
    return undefined;
  }
  const steps: ApplyStep[] = [];
  for (const item of source) {
    const value = ApplyStepBody(item);
    if (value instanceof type.errors) {
      // A partial parse would shift later outcomes and invent not-run rows.
      return undefined;
    }
    steps.push(withCause(value, item));
  }
  return steps;
};

/** Instance the inspect step names. Equals the product when unnamed. */
export const planStepInstance = (step: PlanStepRef): string => {
  const instance = typeof step.instance === "string" ? step.instance.trim() : "";
  return instance === "" ? step.product : instance;
};

const sameStep = (step: ApplyStep, planned: PlanStepRef): boolean =>
  step.product === planned.product &&
  step.instance === planStepInstance(planned) &&
  step.action === planned.action &&
  step.to_version === planned.to;

/**
 * Plan order: reported outcomes where they match, not run where they do not.
 * Extra apply rows stay when inspect was truncated. Admission may report only
 * a later blocked step, so this is identity, not a prefix of the array.
 */
export const applyRows = (
  steps: ApplyStep[],
  planSteps: readonly PlanStepRef[] | undefined,
): ApplyRow[] => {
  if (planSteps === undefined || planSteps.length === 0) {
    const rows: ApplyRow[] = [];
    for (const step of steps) {
      rows.push(step);
    }
    return rows;
  }
  const used = new Set<number>();
  const rows: ApplyRow[] = [];
  for (const planned of planSteps) {
    const index = steps.findIndex(
      (step, position) => !used.has(position) && sameStep(step, planned),
    );
    if (index === -1) {
      rows.push({
        product: planned.product,
        instance: planStepInstance(planned),
        action: planned.action,
        status: APPLY_COPY.notRun,
        to_version: planned.to,
      });
      continue;
    }
    used.add(index);
    const step = steps[index];
    if (step !== undefined) {
      rows.push(step);
    }
  }
  for (let index = 0; index < steps.length; index += 1) {
    if (used.has(index)) {
      continue;
    }
    const step = steps[index];
    if (step !== undefined) {
      rows.push(step);
    }
  }
  return rows;
};

/** Success or 422 body: rows when steps are present, otherwise unavailable. */
export const applyView = (
  ok: boolean,
  text: string,
  raw: unknown,
  planSteps?: readonly PlanStepRef[],
): ApplyView => {
  const steps = parseApplySteps(raw);
  if (steps === undefined) {
    return { ok, text, detail: "unavailable" };
  }
  return { ok, text, rows: applyRows(steps, planSteps) };
};

/** 403 is no access; 422 may still carry steps; other errors stay a message. */
export const applyViewFromError = (
  error: ApiError,
  planSteps?: readonly PlanStepRef[],
): ApplyView => {
  if (error.status === 403) {
    return { ok: false, text: APPLY_COPY.forbidden, detail: "forbidden" };
  }
  const text = /HTTP \d{3}|\/v1\//.test(error.message) ? "Could not apply" : error.message;
  if (error.status === 422) {
    return applyView(false, text, error.body, planSteps);
  }
  return { ok: false, text };
};

export const stepRestored = (row: ApplyRow): string => {
  const restored = row.restored_version?.trim() ?? "";
  return restored === "" ? APPLY_COPY.none : restored;
};

export const stepAttempt = (row: ApplyRow): string => {
  const attempt = row.attempt_id?.trim() ?? "";
  return attempt === "" ? APPLY_COPY.none : attempt;
};

export const stepDetail = (row: ApplyRow): string => row.detail ?? "";

export const stepCut = (row: ApplyRow): boolean => row.detail_truncated === true;

/** A step apply refused because a live object moved since planning names it. */
export const stepStale = (row: ApplyRow): string | undefined =>
  row.stale_target === undefined
    ? undefined
    : `${row.stale_target.kind} ${row.stale_target.name} changed since planning`;
