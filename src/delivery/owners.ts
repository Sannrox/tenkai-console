import { type } from "arktype";
import { ApiError, request } from "../api/http";
import type {
  EnvironmentInspectReport,
  OwnerView,
  ReachabilityVerdict,
  SetOwnerRequest,
  WebhookEndpoint,
} from "../api/tenkai.gen";
import type { StatusRow } from "./identity";
import { statusInstance } from "./identity";

// Owners and notification routing (Tenkai #1066): who an environment or
// product belongs to, which URLs it notifies, the raw webhook deliveries, and
// whether notifications reach the owner (Tenkai #1279).

export type Load<T> =
  | { kind: "ok"; value: T }
  | { kind: "unavailable" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string };

/** A failed read as the console shows it: never the server's raw text. */
export const failedLoad = (error: unknown): Load<never> => {
  if (error instanceof ApiError) {
    if ([404, 405, 503].includes(error.status)) {
      return { kind: "unavailable" };
    }
    if (error.status === 403) {
      return { kind: "forbidden" };
    }
  }
  return { kind: "error", message: "Could not load" };
};

const WebhookDelivery = type({
  id: "string",
  event: "string",
  url: "string",
  state: "string",
  attempts: "number",
  next_attempt_at: "number",
  "delivered_at?": "number",
  "last_error?": "string",
  // Kind stays a string so a source kind this console does not know reads as is.
  "sources?": type({ kind: "string", name: "string", "+": "delete" }).array(),
  "+": "delete",
});

export type WebhookDelivery = typeof WebhookDelivery.infer;

const readDeliveries = async (
  path: string,
  token: string,
  fetcher: typeof fetch,
): Promise<Load<WebhookDelivery[]>> => {
  let raw: unknown;
  try {
    raw = await request<unknown>(path, { token }, fetcher);
  } catch (error) {
    return failedLoad(error);
  }
  // Tenkai #1327 pages the lists as `{items, next_cursor}`, newest first;
  // older servers answer a bare array. The console reads the first page.
  const items = typeof raw === "object" && raw !== null && "items" in raw ? raw.items : raw;
  const value = WebhookDelivery.array()(items);
  return value instanceof type.errors
    ? { kind: "error", message: "Could not load" }
    : { kind: "ok", value };
};

/** `GET /v1/environments/{environment}/webhooks/deliveries`, the newest page. */
export const fetchDeliveries = (
  environment: string,
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<Load<WebhookDelivery[]>> =>
  readDeliveries(
    `v1/environments/${encodeURIComponent(environment)}/webhooks/deliveries`,
    token,
    fetcher,
  );

/**
 * `GET /v1/products/{product}/webhooks/deliveries` (Tenkai #1291): deliveries
 * the product's endpoints routed, in every environment the caller may read.
 * Older servers and tenant mode read as unavailable.
 */
export const fetchProductDeliveries = (
  product: string,
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<Load<WebhookDelivery[]>> =>
  readDeliveries(`${productPath(product, "webhooks")}/deliveries`, token, fetcher);

export type DeliveryRow = {
  id: string;
  url: string;
  event: string;
  /** As the server sent it; a state this console does not know reads as is. */
  state: string;
  tone: "ok" | "warn" | "muted";
  attempts: number;
  next: string;
  error: string;
};

const DELIVERY_TONE: Record<string, DeliveryRow["tone"]> = {
  delivered: "ok",
  retrying: "warn",
};

/** One row per delivery, labelled by URL; the next attempt only while one is due. */
export const deliveryRows = (deliveries: WebhookDelivery[]): DeliveryRow[] =>
  deliveries.map((delivery) => ({
    id: delivery.id,
    url: delivery.url.trim() || "none",
    event: delivery.event,
    state: delivery.state,
    tone: DELIVERY_TONE[delivery.state] ?? "muted",
    attempts: delivery.attempts,
    next:
      delivery.delivered_at === undefined && delivery.next_attempt_at > 0
        ? new Date(delivery.next_attempt_at).toISOString()
        : "·",
    error: delivery.last_error?.trim() ?? "",
  }));

/** True when nothing routes this environment's failures to anyone. */
export const unrouted = (report: Pick<EnvironmentInspectReport, "owner" | "webhooks">): boolean =>
  report.owner === undefined && (report.webhooks ?? []).length === 0;

/** Product owners per instance, as the status rows report them. */
export const statusOwners = (rows: StatusRow[]): { instance: string; owner: string }[] =>
  rows.map((row) => ({ instance: statusInstance(row), owner: row.owner?.trim() || "none" }));

export type Tone = "ok" | "warn" | "bad" | "muted";

const VERDICT_TONE: Partial<Record<string, Tone>> = {
  reachable: "ok",
  unreachable: "bad",
  unknown: "warn",
  unconfigured: "warn",
} satisfies Record<ReachabilityVerdict, Tone>;

export type EndpointRow = {
  url: string;
  /** As the server sent it; a verdict this console does not know reads as is. */
  verdict: string;
  tone: Tone;
  failures: number;
  /** Latest recorded success, or `·` when none is recorded. */
  lastSuccess: string;
};

export type OwnerReach = { verdict: string; tone: Tone; endpoints: EndpointRow[] };

/**
 * The server's reachability verdict for an owner and each of its endpoints.
 * Undefined when the server does not report one (older servers, or reads
 * other than environment inspect): the console never derives a verdict.
 */
export const ownerReach = (owner: OwnerView | null | undefined): OwnerReach | undefined => {
  const reach = owner?.reachability;
  if (reach === undefined) {
    return undefined;
  }
  return {
    verdict: reach.verdict,
    tone: VERDICT_TONE[reach.verdict] ?? "muted",
    endpoints: (reach.endpoints ?? []).map((endpoint) => ({
      url: endpoint.url,
      verdict: endpoint.verdict,
      tone: VERDICT_TONE[endpoint.verdict] ?? "muted",
      failures: endpoint.consecutive_failures,
      lastSuccess:
        endpoint.last_success_at === undefined
          ? "·"
          : new Date(endpoint.last_success_at).toISOString(),
    })),
  };
};

/** The owner contact, or `none`. */
export const ownerLine = (owner: OwnerView | null | undefined): string =>
  owner ? owner.contact : "none";

export const endpointsLine = (endpoints: string[] | undefined): string =>
  (endpoints ?? []).length === 0 ? "none" : (endpoints ?? []).join(" · ");

/** Body of `PUT /v1/products/{product}/owner`. */
export const setOwnerBody = (contact: string): SetOwnerRequest => ({ contact: contact.trim() });

export const productPath = (product: string, leaf: "owner" | "webhooks"): string =>
  `v1/products/${encodeURIComponent(product)}/${leaf}`;

/** `DELETE` target that removes one product endpoint and keeps the others. */
export const productEndpointPath = (product: string, url: string): string =>
  `${productPath(product, "webhooks")}?url=${encodeURIComponent(url)}`;

export type ProductRouting = { owner: OwnerView | null; webhooks: WebhookEndpoint[] };

/** A product's owner and its own endpoints. Two GETs; either failing fails the row. */
export const fetchProductRouting = async (
  product: string,
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<Load<ProductRouting>> => {
  try {
    const [owner, webhooks] = await Promise.all([
      request<OwnerView | null>(productPath(product, "owner"), { token }, fetcher),
      request<WebhookEndpoint[]>(productPath(product, "webhooks"), { token }, fetcher),
    ]);
    return { kind: "ok", value: { owner, webhooks: Array.isArray(webhooks) ? webhooks : [] } };
  } catch (error) {
    return failedLoad(error);
  }
};
