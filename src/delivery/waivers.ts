import type {
  ExposureWaiver,
  ExposureWaiverClearRequest,
  ExposureWaiverRequest,
  MatchedExposure,
  WaiverCategory,
  WaiverScopeKind,
} from "../api/tenkai.gen";

/**
 * Advisory waivers on advisory-feed matches (Sannrox/tenkai#1064). The server
 * attaches only unexpired waivers to `GET /v1/advisory-feed` matches; the
 * console adds the expiring-soon highlight and builds set and clear bodies.
 */

/** Console choice, not server policy: a waiver ending within a week is highlighted. */
export const EXPIRING_SOON_MS = 7 * 24 * 60 * 60 * 1000;

export const WAIVER_SCOPES = [
  "release",
  "component",
  "product",
  "global",
] as const satisfies readonly WaiverScopeKind[];

export const WAIVER_CATEGORIES = [
  "false_positive",
  "mitigated",
  "upstream_dependency",
] as const satisfies readonly WaiverCategory[];

export type WaiverState = "none" | "active" | "expiring";

/** Whether a match is waived at `now`; an expired waiver no longer marks it. */
export const waiverState = (waiver: ExposureWaiver | undefined, now: number): WaiverState => {
  if (waiver === undefined || waiver.expires_at <= now) {
    return "none";
  }
  return waiver.expires_at - now <= EXPIRING_SOON_MS ? "expiring" : "active";
};

/** Product of a match, as Tenkai derives it: from the release id, else the spec. */
export const matchProduct = (match: MatchedExposure): string =>
  (match.release_id.startsWith("tenkai:release:")
    ? match.release_id.slice("tenkai:release:".length)
    : match.release
  ).split("@")[0] ?? "";

type Target = Pick<ExposureWaiverRequest, "release_id" | "product" | "component">;

/** The one field a scope names; global names none (the server refuses extras). */
export const scopeTarget = (scope: WaiverScopeKind, match: MatchedExposure): Target =>
  ({
    release: { release_id: match.release_id },
    component: { component: match.component },
    product: { product: matchProduct(match) },
    global: {},
  })[scope];

/** What a scope covers, in the words the confirmation and the table use. */
export const scopeLabel = (scope: WaiverScopeKind, target: Target): string =>
  ({
    release: `release ${target.release_id ?? ""}`,
    component: `component ${target.component ?? ""}`,
    product: `product ${target.product ?? ""}`,
    global: "every product",
  })[scope];

/** `POST /v1/exposures/waivers` body; the contract carries no generation. */
export const waiverSetBody = (
  match: MatchedExposure,
  form: { scope: WaiverScopeKind; category: WaiverCategory; reason: string; expires: string },
): ExposureWaiverRequest => ({
  version: 1,
  operation: "waiver_set",
  advisory_id: match.advisory_id,
  scope: form.scope,
  category: form.category,
  reason: form.reason.trim(),
  expires: form.expires.trim(),
  ...scopeTarget(form.scope, match),
});

/** `POST /v1/exposures/waivers/clear` body naming the waiver's own scope and target. */
export const waiverClearBody = (
  waiver: ExposureWaiver,
  reason: string,
): ExposureWaiverClearRequest => ({
  version: 1,
  operation: "waiver_clear",
  advisory_id: waiver.advisory_id,
  scope: waiver.scope,
  reason: reason.trim(),
  release_id: waiver.release_id ?? null,
  component: waiver.component ?? null,
  product: waiver.product ?? null,
});

/** One table cell: scope, category, expiry, and who set it. */
export const waiverLine = (waiver: ExposureWaiver): string =>
  `${scopeLabel(waiver.scope, waiver)} · ${waiver.category.replaceAll("_", " ")} · until ${new Date(waiver.expires_at).toISOString().slice(0, 16)}Z · by ${waiver.actor}`;
