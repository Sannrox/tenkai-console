import { type } from "arktype";
import type { EnvironmentPlanSummary } from "../api/tenkai.gen";

// What a plan changes in the target, per step and per Kubernetes object or
// host file. Inspect's `latest_plan` carries per-object counts without field
// values; `GET /v1/plans/{id}` carries every field change. Servers older than
// that route omit `target_changes` and answer the route with 404.
//
// Server data is validated here, not trusted: a malformed object is dropped
// rather than rendered, and a secret object never exposes its fields.

const FieldChange = type({ field: "string", "from?": "string", "to?": "string", "+": "delete" });
const ObjectChange = type({
  kind: "string",
  name: "string",
  live_digest: "string",
  "field_count?": "number",
  "fields?": FieldChange.array(),
  "+": "delete",
});

export type FieldDiff = typeof FieldChange.infer;

/** One changed object or file. `fields` is undefined when only counts are known. */
export type ObjectDiff = {
  kind: string;
  name: string;
  count: number;
  created: boolean;
  /** Secret-like objects show only that their content digest changed. */
  secret: boolean;
  fields: FieldDiff[] | undefined;
};

export type StepDiff = { id: string; label: string; objects: ObjectDiff[] };

/** Rendered field rows across the whole page, and characters per value. */
export const DIFF_LIMITS = { rows: 500, value: 400 } as const;

export const DIFF_COPY = {
  secret: "content digest changed",
  created: "new",
  changed: "changed",
  cut: "cut",
} as const;

/** Secret, SealedSecret, and other secret-bearing kinds never show fields. */
export const isSecretKind = (kind: string): boolean => /secret/i.test(kind);

const objectDiff = (raw: unknown): ObjectDiff | undefined => {
  const change = ObjectChange(raw);
  if (change instanceof type.errors) {
    return undefined;
  }
  const secret = isSecretKind(change.kind);
  const listed = change.fields ?? [];
  const count = Math.max(change.field_count ?? 0, listed.length);
  const created = change.live_digest === "absent";
  if (count === 0 && !created) {
    // Live already matches; nothing will change.
    return undefined;
  }
  return {
    kind: change.kind,
    name: change.name,
    count,
    created,
    secret,
    fields: secret || listed.length === 0 ? undefined : listed,
  };
};

/** Steps that change something in the target, in plan order. */
export const stepDiffs = (plan: EnvironmentPlanSummary | null | undefined): StepDiff[] => {
  const diffs: StepDiff[] = [];
  for (const step of plan?.steps ?? []) {
    const raw: unknown = step.target_changes;
    const objects = (Array.isArray(raw) ? raw : [])
      .map(objectDiff)
      .filter((object) => object !== undefined);
    if (objects.length > 0) {
      const instance = step.instance && step.instance !== step.product ? `/${step.instance}` : "";
      diffs.push({ id: step.id, label: `${step.product}${instance} ${step.action}`, objects });
    }
  }
  return diffs;
};

/** True when some changed object has a count but no field values to show. */
export const countsOnly = (diffs: StepDiff[]): boolean =>
  diffs.some((step) => step.objects.some((object) => !object.secret && !object.fields));

/** Long server values are cut so one field cannot flood the page. */
export const cutValue = (value: string): string =>
  value.length > DIFF_LIMITS.value
    ? `${value.slice(0, DIFF_LIMITS.value)} ${DIFF_COPY.cut}`
    : value;

/** Field rows that fit under the page cap, and how many changes were left out. */
export const capRows = (diffs: StepDiff[]): { shown: Set<FieldDiff>; hidden: number } => {
  const shown = new Set<FieldDiff>();
  let hidden = 0;
  for (const step of diffs) {
    for (const object of step.objects) {
      for (const field of object.fields ?? []) {
        if (shown.size < DIFF_LIMITS.rows) {
          shown.add(field);
        } else {
          hidden += 1;
        }
      }
    }
  }
  return { shown, hidden };
};

export const fieldsLabel = (count: number): string => (count === 1 ? "1 field" : `${count} fields`);

export const planPath = (planId: string): string => `v1/plans/${encodeURIComponent(planId)}`;
