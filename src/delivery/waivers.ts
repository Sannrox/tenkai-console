import { type } from "arktype";
import { ApiError, request } from "../api/http";
import type {
  EnvironmentGrace,
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
 * `GET /v1/exposures/waivers` lists every stored waiver, and grace ends and
 * windows come from the server as sent (Sannrox/tenkai#1277).
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

/** A server instant to the minute, in UTC. */
export const minuteUtc = (ms: number): string => `${new Date(ms).toISOString().slice(0, 16)}Z`;

/** One table cell: scope, category, expiry, and who set it. */
export const waiverLine = (waiver: ExposureWaiver): string =>
  `${scopeLabel(waiver.scope, waiver)} · ${waiver.category.replaceAll("_", " ")} · until ${minuteUtc(waiver.expires_at)} · by ${waiver.actor}`;

const Waiver = type({
  actor: "string",
  advisory_id: "string",
  category: type.enumerated(...WAIVER_CATEGORIES),
  "component?": "string",
  expires_at: "number",
  "product?": "string",
  reason: "string",
  "release_id?": "string",
  scope: type.enumerated(...WAIVER_SCOPES),
});
const WaiverList = type({ waivers: Waiver.array() });

export type WaiverListLoad =
  | { kind: "ok"; waivers: ExposureWaiver[] }
  | { kind: "unavailable" }
  | { kind: "forbidden" }
  | { kind: "error" };

export const waiverListPath = (includeExpired: boolean): string =>
  includeExpired ? "v1/exposures/waivers?include_expired=true" : "v1/exposures/waivers";

/**
 * Stored waivers, soonest expiry first. The server returns expired ones only
 * when asked. 403 is no permission; 405 (the route predates the list) or a
 * bare 404 is an older server; nothing raw is shown.
 */
export const fetchWaivers = async (
  includeExpired: boolean,
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<WaiverListLoad> => {
  let raw: unknown;
  try {
    raw = await request<unknown>(waiverListPath(includeExpired), { token }, fetcher);
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 403) {
        return { kind: "forbidden" };
      }
      if (error.status === 405 || error.status === 404) {
        return { kind: "unavailable" };
      }
    }
    return { kind: "error" };
  }
  const list = WaiverList(raw);
  return list instanceof type.errors
    ? { kind: "error" }
    : {
        kind: "ok",
        waivers: list.waivers.toSorted((a, b) => a.expires_at - b.expires_at),
      };
};

/** Environments where a finding is still within grace, as the server reports them. */
export const inGrace = (grace: readonly EnvironmentGrace[] | undefined): EnvironmentGrace[] =>
  (grace ?? []).filter((entry) => entry.in_grace);
