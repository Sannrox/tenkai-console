import { type } from "arktype";
import { ApiError, request } from "../api/http";
import type {
  EnvironmentInspectReport,
  OwnerView,
  SetOwnerRequest,
  WebhookEndpoint,
} from "../api/tenkai.gen";
import type { StatusRow } from "./identity";
import { statusInstance } from "./identity";

// Owners and notification routing (Tenkai #1066): who an environment or
// product belongs to, which URLs it notifies, and the raw webhook deliveries.

export type Load<T> =
  | { kind: "ok"; value: T }
  | { kind: "unavailable" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string };

/** A failed read as the console shows it: never the server's raw text. */
const failedLoad = (error: unknown): Load<never> => {
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
  "+": "delete",
});

export type WebhookDelivery = typeof WebhookDelivery.infer;

/** `GET /v1/environments/{environment}/webhooks/deliveries`, newest first per kind. */
export const fetchDeliveries = async (
  environment: string,
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<Load<WebhookDelivery[]>> => {
  let raw: unknown;
  try {
    raw = await request<unknown>(
      `v1/environments/${encodeURIComponent(environment)}/webhooks/deliveries`,
      { token },
      fetcher,
    );
  } catch (error) {
    return failedLoad(error);
  }
  const value = WebhookDelivery.array()(raw);
  return value instanceof type.errors
    ? { kind: "error", message: "Could not load" }
    : { kind: "ok", value };
};

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

/** The owner contact, or `none`. */
export const ownerLine = (owner: OwnerView | null | undefined): string =>
  owner ? owner.contact : "none";

export const endpointsLine = (endpoints: string[] | undefined): string =>
  (endpoints ?? []).length === 0 ? "none" : (endpoints ?? []).join(" · ");

/** Body of `PUT /v1/products/{product}/owner`. */
export const setOwnerBody = (contact: string): SetOwnerRequest => ({ contact: contact.trim() });

export const productPath = (product: string, leaf: "owner" | "webhooks"): string =>
  `v1/products/${encodeURIComponent(product)}/${leaf}`;

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
