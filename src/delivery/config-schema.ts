import { type } from "arktype";

// `EnvironmentInspectReport.config` (Tenkai #1019). The pinned contract
// predates the field, so it is validated here rather than trusted as a
// generated type.
//
// Reuse decision
// Job: show per-key overlay admission against a release-declared schema,
// including a visible passing check and a refusal with path, reason, and
// schema reference.
// Verdict: Reuse
// Concept: extra inspect fields as in `instances.ts`; arktype parse as in
// `dependencies.ts` / `history.ts`; plan POST already returns the refusal
// string, rewritten the way `compatibility.ts` maps reasons.
// Edge: overlay set is not an HTTP route; secrets are names only; pin stays.
// Searched: inspect.config, overlay HTTP routes (none), plan status_detail,
// latest_failures, overlay_stale. Rejected: pin bump; overlay editor.
// Overlays load with the history lazy chunk so the initial bundle stays put.

const ProductConfig = type({
  product: "string",
  "digest?": "string",
  "overlay?": "Record<string, string>",
  "defaults?": "Record<string, string>",
  "secrets?": "string[]",
});

export type ProductConfig = typeof ProductConfig.infer;

export type OverlaySource = "overlay" | "default" | "secret";
export type OverlayFailureReason =
  | "not declared"
  | "must be an integer"
  | "must be true or false"
  | "not an allowed value"
  | "required"
  | "secret name";
export type OverlayCheck = "checked" | "declared" | OverlayFailureReason;

export type OverlayRow = {
  product: string;
  key: string;
  value: string;
  source: OverlaySource;
  check: OverlayCheck;
  schema: string;
};

export type OverlayRefusal = {
  key: string;
  reason: OverlayFailureReason;
};

const byKey = ([left]: [string, string], [right]: [string, string]) => left.localeCompare(right);

/** Product rows the inspect body actually sent; drop a malformed row, not the rest. */
export const parseInspectConfig = (report: unknown): ProductConfig[] => {
  if (typeof report !== "object" || report === null || !("config" in report)) {
    return [];
  }
  const raw = report.config;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap((row) => {
    const value = ProductConfig(row);
    return value instanceof type.errors ? [] : [value];
  });
};

/** Channel-head release each product is checked against. */
export const schemaHeads = (report: unknown): ReadonlyMap<string, string> => {
  if (typeof report !== "object" || report === null || !("subscriptions" in report)) {
    return new Map();
  }
  const subscriptions = report.subscriptions;
  if (!Array.isArray(subscriptions)) {
    return new Map();
  }
  const heads = new Map<string, string>();
  for (const row of subscriptions) {
    if (
      typeof row === "object" &&
      row !== null &&
      "product" in row &&
      "head" in row &&
      typeof row.product === "string" &&
      typeof row.head === "string"
    ) {
      const head = row.head.trim();
      heads.set(row.product, head === "" ? "none" : head);
    }
  }
  return heads;
};

const schemaPresent = (product: ProductConfig): boolean =>
  (product.secrets?.length ?? 0) > 0 || Object.keys(product.defaults ?? {}).length > 0;

/** Overlay, default, and declared secret rows for one inspect body. */
export const overlayRows = (
  config: ProductConfig[],
  heads: ReadonlyMap<string, string>,
): OverlayRow[] => {
  const rows: OverlayRow[] = [];
  for (const product of config) {
    const schema = heads.get(product.product) ?? "none";
    const overlay = product.overlay ?? {};
    const defaults = product.defaults ?? {};
    const checked: OverlayCheck = schemaPresent(product) ? "checked" : "declared";
    for (const [key, value] of Object.entries(overlay).toSorted(byKey)) {
      rows.push({
        product: product.product,
        key,
        value,
        source: "overlay",
        check: checked,
        schema,
      });
    }
    for (const [key, value] of Object.entries(defaults).toSorted(byKey)) {
      if (Object.hasOwn(overlay, key)) {
        continue;
      }
      rows.push({
        product: product.product,
        key,
        value,
        source: "default",
        check: "checked",
        schema,
      });
    }
    for (const key of product.secrets ?? []) {
      const name = key.trim();
      if (name === "") {
        continue;
      }
      rows.push({
        product: product.product,
        key: name,
        value: "",
        source: "secret",
        check: "declared",
        schema,
      });
    }
  }
  return rows;
};

const REFUSALS: { match: RegExp; reason: OverlayFailureReason }[] = [
  { match: /overlay (\S+) is not declared by the release config schema/, reason: "not declared" },
  { match: /overlay (\S+) must be an integer/, reason: "must be an integer" },
  { match: /overlay (\S+) must be true or false/, reason: "must be true or false" },
  { match: /overlay (\S+) is not an allowed value/, reason: "not an allowed value" },
  { match: /overlay (\S+) is required by the release config schema/, reason: "required" },
  { match: /overlay (\S+) is a declared secret name/, reason: "secret name" },
];

/** Structured overlay refusal from a plan or overlay-set error string. */
export const overlayRefusal = (message: string): OverlayRefusal | undefined => {
  for (const rule of REFUSALS) {
    const found = message.match(rule.match);
    const key = found?.[1]?.trim() ?? "";
    if (key !== "") {
      return { key, reason: rule.reason };
    }
  }
  return undefined;
};

const ownsKey = (product: ProductConfig, key: string): boolean =>
  product.overlay?.[key] !== undefined ||
  product.defaults?.[key] !== undefined ||
  (product.secrets?.includes(key) ?? false);

/** Channel head the refusal is checked against. */
export const refusalSchema = (
  refusal: OverlayRefusal,
  config: ProductConfig[],
  heads: ReadonlyMap<string, string>,
): string => {
  const owner = config.find((product) => ownsKey(product, refusal.key));
  if (owner) {
    return heads.get(owner.product) ?? "none";
  }
  const declared = config.find(schemaPresent);
  if (declared) {
    return heads.get(declared.product) ?? "none";
  }
  return heads.values().next().value ?? "none";
};

/** Append or mark the refused key so a missing required overlay is visible. */
export const withRefusal = (
  rows: OverlayRow[],
  refusal: OverlayRefusal | undefined,
  config: ProductConfig[],
  heads: ReadonlyMap<string, string>,
): OverlayRow[] => {
  if (refusal === undefined) {
    return rows;
  }
  const schema = refusalSchema(refusal, config, heads);
  const index = rows.findIndex((row) => row.key === refusal.key);
  if (index >= 0) {
    return rows.map((row, at) => (at === index ? { ...row, check: refusal.reason, schema } : row));
  }
  const product =
    config.find(schemaPresent)?.product ?? config[0]?.product ?? heads.keys().next().value ?? "";
  return [
    ...rows,
    {
      product,
      key: refusal.key,
      value: "",
      source: "overlay",
      check: refusal.reason,
      schema,
    },
  ];
};
