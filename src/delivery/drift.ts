import { type } from "arktype";
import { deployedLabel } from "./dependencies";

// `EnvironmentSubscriptionView.spec_drift` (Tenkai #1028). The pinned
// contract predates the field, so it is validated here rather than trusted
// as a generated type.
//
// Reuse decision
// Job: show report-only live-spec mismatches per instance, separated from
// desired and applied state, with no actions.
// Verdict: Reuse
// Concept: extra inspect subscription fields as in `instances.ts`; arktype
// parse as in `config-schema.ts`; environment-detail table as overlays;
// running release via `deployedLabel`.
// Edge: omitted spec_drift is an older server; a mix of observed and omitted
// is incomplete detection, not `none`; `unknown` is an adapter that cannot
// fingerprint; field names only, never values; pin stays.
// Searched: spec_drift, SpecDriftView, fleet products_behind (version lag),
// overlay_stale. Rejected: pin bump; reconcile or restart from the table.

const SpecDriftObject = type({
  kind: "string",
  name: "string",
  status: "string",
  "fields?": "string[]",
});

const SpecDriftView = type({
  status: "string",
  "objects?": SpecDriftObject.array(),
});

export type DriftStatus = "none" | "unavailable" | "drifted";

export type DriftRow = {
  instance: string;
  product: string;
  release: string;
  object: string;
  differs: string;
  status: DriftStatus;
  held: boolean;
};

export type DriftLoad =
  | { kind: "unavailable" }
  | { kind: "none" }
  | { kind: "ok"; rows: DriftRow[] };

const objectLabel = (kind: string, name: string): string => {
  const k = kind.trim();
  const n = name.trim();
  if (k === "" && n === "") {
    return "·";
  }
  if (k === "") {
    return n;
  }
  if (n === "") {
    return k;
  }
  return `${k}/${n}`;
};

/** Cheap field names only; drop anything that looks like a value. */
export const fieldSummary = (fields: string[] | undefined): string => {
  const names = (fields ?? [])
    .map((field) => field.trim())
    .filter((field) => field !== "" && !field.includes("=") && !field.includes(":"));
  return names.length === 0 ? "·" : names.join(", ");
};

export const driftStatus = (status: string): DriftStatus => {
  if (status === "current") {
    return "none";
  }
  if (status === "modified outside Tenkai") {
    return "drifted";
  }
  return "unavailable";
};

const instanceName = (row: { instance?: unknown; product: string }): string => {
  const instance = typeof row.instance === "string" ? row.instance.trim() : "";
  return instance === "" ? row.product : instance;
};

const isHeld = (row: object, envHeld: boolean): boolean =>
  envHeld || ("delivery_hold" in row && row.delivery_hold != null);

const deployedVersion = (row: object): string | null | undefined => {
  if (!("deployed" in row)) {
    return undefined;
  }
  if (typeof row.deployed === "string" || row.deployed === null) {
    return row.deployed;
  }
  return undefined;
};

type SubscriptionId = {
  instance: string;
  product: string;
  release: string;
  held: boolean;
};

const subscriptionId = (raw: object, envHeld: boolean): SubscriptionId | undefined => {
  if (!("product" in raw) || typeof raw.product !== "string") {
    return undefined;
  }
  const product = raw.product;
  const held = isHeld(raw, envHeld);
  return {
    instance: instanceName({
      product,
      ...("instance" in raw ? { instance: raw.instance } : {}),
    }),
    product,
    release: deployedLabel(deployedVersion(raw), held),
    held,
  };
};

const unavailableRow = (id: SubscriptionId): DriftRow => ({
  ...id,
  object: "·",
  differs: "·",
  status: "unavailable",
});

/** Drift rows the inspect body actually sent. */
export const parseInspectDrift = (report: unknown): DriftLoad => {
  if (typeof report !== "object" || report === null || !("subscriptions" in report)) {
    return { kind: "unavailable" };
  }
  const subscriptions = report.subscriptions;
  if (!Array.isArray(subscriptions)) {
    return { kind: "unavailable" };
  }
  const envHeld = "delivery_hold" in report && report.delivery_hold != null;
  let seen = false;
  const rows: DriftRow[] = [];
  const unobserved: DriftRow[] = [];
  for (const raw of subscriptions) {
    if (typeof raw !== "object" || raw === null) {
      continue;
    }
    const id = subscriptionId(raw, envHeld);
    if (id === undefined) {
      continue;
    }
    if (!("spec_drift" in raw) || raw.spec_drift === undefined || raw.spec_drift === null) {
      unobserved.push(unavailableRow(id));
      continue;
    }
    const view = SpecDriftView(raw.spec_drift);
    if (view instanceof type.errors) {
      seen = true;
      rows.push(unavailableRow(id));
      continue;
    }
    seen = true;
    const objects = view.objects ?? [];
    if (objects.length === 0) {
      const status = driftStatus(view.status);
      if (status !== "none") {
        rows.push({
          ...id,
          object: "·",
          differs: "·",
          status,
        });
      }
      continue;
    }
    for (const object of objects) {
      const status = driftStatus(object.status);
      if (status === "none") {
        continue;
      }
      rows.push({
        ...id,
        object: objectLabel(object.kind, object.name),
        differs: fieldSummary(object.fields),
        status,
      });
    }
  }
  if (!seen) {
    return { kind: "unavailable" };
  }
  if (unobserved.length > 0) {
    rows.push(...unobserved);
  }
  return rows.length === 0 ? { kind: "none" } : { kind: "ok", rows };
};
