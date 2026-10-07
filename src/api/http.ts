import { type } from "arktype";
import { TENKAI_CONTRACT } from "./tenkai.gen";
import type { OidcClientDiscovery } from "./tenkai.gen";

/**
 * Where this console and its API live.
 *
 * Production bundles sit at `<base>/ui/assets/*.js`: the console root is one
 * level above the entry module and the API root two. This holds for any
 * proxy prefix without a rebuild. The dev server serves both from its origin.
 */
export const locate = (moduleUrl: string, dev: boolean) =>
  dev
    ? { consoleRoot: new URL("/", moduleUrl), apiRoot: new URL("/", moduleUrl) }
    : { consoleRoot: new URL("../", moduleUrl), apiRoot: new URL("../../", moduleUrl) };

export const { consoleRoot, apiRoot } = locate(import.meta.url, import.meta.env.DEV);

/** A non-2xx response; `message` is the server's `error` text when present. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Typed JSON request against the Tenkai API. */
export const request = async <T>(
  path: string,
  init: {
    token?: string | undefined;
    method?: "GET" | "POST";
    body?: unknown;
    /** Sent as `x-request-id`; the server uses it to correlate audit records. */
    requestId?: string;
  } = {},
  fetcher: typeof fetch = fetch,
): Promise<T> => {
  const headers = new Headers({ accept: "application/json" });
  if (init.token) {
    headers.set("authorization", `Bearer ${init.token}`);
  }
  if (init.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  if (init.requestId) {
    headers.set("x-request-id", init.requestId);
  }
  const response = await fetcher(new URL(path, apiRoot), {
    method: init.method ?? "GET",
    headers,
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => undefined);
    const message =
      typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
        ? body.error
        : `HTTP ${response.status}`;
    throw new ApiError(response.status, message);
  }
  return (await response.json()) as T;
};

// Validated at runtime: /healthz is read before we know the server speaks our contract.
const ServiceStatus = type({
  status: "string",
  profile: "string",
  capabilities: "string[]",
  "contracts?": "string[]",
});

export type ServerCheck =
  | { kind: "ready"; profile: string }
  | { kind: "too-old" }
  | { kind: "unreachable"; reason: string };

/** Reachability plus contract compatibility, before anything else is called. */
export const checkServer = async (fetcher: typeof fetch = fetch): Promise<ServerCheck> => {
  let raw: unknown;
  try {
    raw = await request<unknown>("healthz", {}, fetcher);
  } catch (error) {
    return { kind: "unreachable", reason: error instanceof Error ? error.message : String(error) };
  }
  const status = ServiceStatus(raw);
  if (status instanceof type.errors) {
    return { kind: "unreachable", reason: `unexpected /healthz response: ${status.summary}` };
  }
  return status.contracts?.includes(TENKAI_CONTRACT)
    ? { kind: "ready", profile: status.profile }
    : { kind: "too-old" };
};

/** Public OIDC client settings, or `null` when the server has no OIDC client. */
export const fetchOidcSettings = async (
  fetcher: typeof fetch = fetch,
): Promise<OidcClientDiscovery | null> => {
  try {
    return await request<OidcClientDiscovery>("v1/auth/oidc", {}, fetcher);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
};
