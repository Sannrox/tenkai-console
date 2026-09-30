import { type } from "arktype";

/**
 * Root of the Tenkai API that served this console.
 *
 * Production bundles live at `<base>/ui/assets/*.js`, so the API root is two
 * levels above the entry module. This holds for any proxy prefix without a
 * rebuild. The dev server proxies the API from its own origin instead.
 */
export const apiBase = (moduleUrl: string, dev: boolean): URL =>
  dev ? new URL("/", moduleUrl) : new URL("../../", moduleUrl);

const HealthStatus = type({
  status: "string",
  profile: "string",
  capabilities: "string[]",
});

export type HealthStatus = typeof HealthStatus.infer;

export type HealthResult =
  | { kind: "reachable"; health: HealthStatus }
  | { kind: "unreachable"; reason: string };

/** Unauthenticated `/healthz`, validated at runtime so drift fails loudly. */
export const fetchHealth = async (
  base: URL,
  fetcher: typeof fetch = fetch,
): Promise<HealthResult> => {
  let response: Response;
  try {
    response = await fetcher(new URL("healthz", base));
  } catch (error) {
    return { kind: "unreachable", reason: String(error) };
  }
  if (!response.ok) {
    return { kind: "unreachable", reason: `HTTP ${response.status}` };
  }
  const health = HealthStatus(await response.json());
  if (health instanceof type.errors) {
    return {
      kind: "unreachable",
      reason: `unexpected /healthz response: ${health.summary}`,
    };
  }
  return { kind: "reachable", health };
};
