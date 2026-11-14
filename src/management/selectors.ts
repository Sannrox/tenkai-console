import { type } from "arktype";
import { ApiError, request } from "../api/http";
import { failedLoad, type Load } from "../delivery/owners";
import { holdBody } from "../plan/requests";
import { newRequestId, type Outcome } from "./use-management";

/**
 * Label selectors (Sannrox/tenkai#1278). The server resolves every selector:
 * `GET /v1/environments?selector=` previews the match, and a hold placed by
 * selector records the selector with every environment it matched. The
 * browser never parses or evaluates a selector.
 */

/** A server match, or a refusal naming the clause that does not parse. */
export type SelectorMatch = Load<string[]> | { kind: "invalid"; clause: string | undefined };

const Entries = type({ name: "string" }).array();
const Refusal = type({ "clause?": "string", "reason?": { code: "string" } });

const refusal = (error: ApiError) => {
  const body = Refusal(error.body);
  return body instanceof type.errors ? {} : body;
};

export const selectorPath = (selector: string): string =>
  `v1/environments?${new URLSearchParams({ selector })}`;

/**
 * The environments a selector matches, by name, once each: the list has a
 * row per environment and subscription. A 400 is a selector the server
 * cannot parse; the clause is shown when the server names it.
 */
export const fetchSelectorMatch = async (
  selector: string,
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<SelectorMatch> => {
  let raw: unknown;
  try {
    raw = await request<unknown>(selectorPath(selector), { token }, fetcher);
  } catch (error) {
    if (error instanceof ApiError && error.status === 400) {
      return { kind: "invalid", clause: refusal(error).clause };
    }
    return failedLoad(error);
  }
  const entries = Entries(raw);
  return entries instanceof type.errors
    ? { kind: "error", message: "Could not load" }
    : { kind: "ok", value: [...new Set(entries.map((entry) => entry.name))].toSorted() };
};

/**
 * What one hold-by-selector answer means, in fixed copy. No answer, or a 5xx
 * that may have landed, is unknown and is never resent.
 */
export const selectorHoldOutcome = (environment: string, error?: unknown): Outcome => {
  if (error === undefined) {
    return { tone: "ok", text: `${environment} held and audited.` };
  }
  if (!(error instanceof ApiError) || error.status >= 500) {
    return {
      tone: "unknown",
      text: `No answer for ${environment}; the outcome is unknown until the next read.`,
    };
  }
  const code = refusal(error).reason?.code;
  if (error.status === 403) {
    return { tone: "bad", text: `Not permitted on ${environment}.` };
  }
  if (code === "invalid_selector") {
    return { tone: "bad", text: "The server refused the selector." };
  }
  if (code === "stale_generation") {
    return { tone: "bad", text: `${environment} changed since it was read. It was not held.` };
  }
  if (error.message.includes("does not match selector")) {
    return { tone: "bad", text: `${environment} no longer matches the selector. It was not held.` };
  }
  if (error.status === 422 || error.message.includes("unknown field")) {
    return { tone: "bad", text: "This server cannot hold by selector." };
  }
  return { tone: "bad", text: `Hold on ${environment} refused.` };
};

const Lease = type({ lease: { held: "boolean", "generation?": "number | null" } });

/** One environment's result in a hold placed by selector. */
export type HoldStep = { environment: string; outcome: Outcome };

/**
 * Hold each environment the preview matched, one request each carrying the
 * selector, as `tenkaictl env hold <selector>` does. The environment on
 * screen is fenced by the generation the operator saw; any other match by
 * the generation read just before its hold. The server refuses an
 * environment that no longer matches. Stops at the first result that is not
 * a hold, and never retries.
 */
/** Generation the server expects from a lease read: the held lease's, or 0 when free. */
const leaseGeneration = (lease: { held: boolean; generation?: number | null }): number =>
  lease.held ? (lease.generation ?? 0) : 0;

export const holdBySelector = async (
  call: {
    environments: readonly string[];
    selector: string;
    reason: string;
    observed: { environment: string; generation: number };
  },
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<HoldStep[]> => {
  const steps: HoldStep[] = [];
  for (const environment of call.environments) {
    const path = `v1/environments/${encodeURIComponent(environment)}`;
    let generation = call.observed.generation;
    if (environment !== call.observed.environment) {
      const read = await request<unknown>(path, { token }, fetcher).then(Lease, () => undefined);
      if (read === undefined || read instanceof type.errors) {
        steps.push({
          environment,
          outcome: { tone: "bad", text: `Could not read ${environment}. It was not held.` },
        });
        break;
      }
      generation = leaseGeneration(read.lease);
    }
    const outcome = await request<unknown>(
      `${path}/hold`,
      {
        token,
        method: "POST",
        body: holdBody(environment, generation, call.reason, call.selector),
        requestId: newRequestId(),
      },
      fetcher,
    ).then(
      () => selectorHoldOutcome(environment),
      (error: unknown) => selectorHoldOutcome(environment, error ?? new Error("no answer")),
    );
    steps.push({ environment, outcome });
    if (outcome.tone !== "ok") {
      break;
    }
  }
  return steps;
};
