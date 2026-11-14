import { type } from "arktype";
import { ApiError, request } from "../api/http";
import type { StatusLoad, StatusRow } from "./identity";

const CertificateStatus = type({
  expires_at: "number",
  near_expiry: "boolean",
  "renewal_failure?": "string",
  "+": "delete",
});

// State stays a string so a check state added later reads as a warning, not a bad body.
const HealthCheck = type({
  name: "string",
  state: "string",
  "message?": "string",
  "+": "delete",
});

const Row = type({
  product: "string",
  "instance?": "string",
  "certificate?": CertificateStatus.or("null"),
  "health?": "string | null",
  "error?": "string | null",
  "health_checks?": HealthCheck.array(),
  "+": "delete",
});

/** Parse a status body; `undefined` when it is not this contract. */
export const parseStatus = (raw: unknown): StatusRow[] | undefined => {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const rows: StatusRow[] = [];
  for (const row of raw) {
    const value = Row(row);
    if (value instanceof type.errors) {
      return undefined;
    }
    rows.push(value);
  }
  return rows;
};

const visibleError = (error: ApiError): StatusLoad => {
  if (error.status === 404 || error.status === 405) {
    return { kind: "unavailable" };
  }
  if (error.status === 403) {
    return { kind: "forbidden" };
  }
  return {
    kind: "error",
    message: /HTTP \d{3}|\/v1\//.test(error.message) ? "Could not load" : error.message,
  };
};

/** Read instance status. Older servers may omit the route, the certificate, or health checks. */
export const fetchStatus = async (
  environment: string,
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<StatusLoad> => {
  let raw: unknown;
  try {
    raw = await request<unknown>(
      `v1/environments/${encodeURIComponent(environment)}/status`,
      { token },
      fetcher,
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return visibleError(error);
    }
    return { kind: "error", message: "Could not load" };
  }
  const value = parseStatus(raw);
  return value ? { kind: "ok", value } : { kind: "error", message: "Could not load" };
};
