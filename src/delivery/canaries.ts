import { type } from "arktype";
import { ApiError, request } from "../api/http";
import type { CanaryDesignationRequest } from "../api/tenkai.gen";
import { selectorLine } from "./hold";
import { failedLoad, type Load } from "./owners";

/**
 * Designated canary environments (Tenkai #1358, #1360). `GET /v1/canaries`
 * lists each designation with who set it, when, and the selector that chose
 * it when one did. `POST /v1/canaries` designates or undesignates by that
 * selector; the server resolves the match. The browser never evaluates it.
 *
 * Reuse decision
 * Job: record a query that produced a frozen set of targets, beside that set,
 * read both back, and write the set by sending the query.
 * Verdict: Reuse
 * Concept: `SelectorInput` / `fetchSelectorMatch` from #167; `HoldSelector`
 * on the designation and on the promotion-policy canary cohort.
 * Edge: wave HTTP and a selector on the promotion policy itself are not on
 * the versioned contract. Credentials stay on the existing management call.
 * Searched: canary designate, canary policy, wave cohort, hold selector,
 * promotion-policy view. Rejected: a second selector parser; wave routes;
 * a selector field on the promotion policy (ADR 0054 §8).
 */

const Selector = type({ selector: "string", environments: "string[]", "+": "delete" });

const Designation = type({
  environment: "string",
  "selector?": Selector,
  "set_by?": "string",
  "set_at?": "number",
  "+": "delete",
});

export type CanaryDesignation = typeof Designation.infer;

export type CanariesLoad = Load<CanaryDesignation[]>;

/** `v1/canaries`. */
export const canariesPath = "v1/canaries";

/** The designation list, never the server's raw text on failure. */
export const fetchCanaries = async (
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<CanariesLoad> => {
  let raw: unknown;
  try {
    raw = await request<unknown>(canariesPath, { token }, fetcher);
  } catch (error) {
    return failedLoad(error);
  }
  const rows = Designation.array()(raw);
  return rows instanceof type.errors
    ? { kind: "error", message: "Could not load" }
    : {
        kind: "ok",
        value: rows.toSorted((left, right) => left.environment.localeCompare(right.environment)),
      };
};

/** POST body: exactly the selector, never a name list the browser built. */
export const designateBody = (selector: string, designated: boolean): CanaryDesignationRequest => ({
  designated,
  selector,
});

/**
 * How the designation was chosen: the selector and the set it resolved to,
 * or `name` when the operator named the environment.
 */
export const chosenBy = (row: CanaryDesignation): string =>
  row.selector === undefined ? "name" : selectorLine(row.selector);

const refusal = (error: ApiError) => {
  const body = type({ "reason?": { code: "string" } })(error.body);
  return body instanceof type.errors ? undefined : body.reason?.code;
};

/**
 * What a designate or undesignate answer means. No answer, or a 5xx that may
 * have landed, is unknown and is never resent.
 */
export const designateOutcome = (
  designated: boolean,
  error: unknown,
): { tone: "ok" | "bad" | "unknown"; text: string } => {
  if (error === undefined) {
    return {
      tone: "ok",
      text: designated ? "Designated and audited." : "Undesignated and audited.",
    };
  }
  if (!(error instanceof ApiError) || error.status >= 500) {
    return {
      tone: "unknown",
      text: "No answer from the server; the outcome is unknown until the next read.",
    };
  }
  if (error.status === 403) {
    return { tone: "bad", text: "Not permitted." };
  }
  if (error.status === 404 || error.status === 405) {
    return { tone: "bad", text: "This server cannot designate canaries." };
  }
  if (refusal(error) === "invalid_selector") {
    return { tone: "bad", text: "The server refused the selector." };
  }
  if (error.status === 409 && error.message.includes("matches no environment")) {
    return { tone: "bad", text: "The selector matches none. Nothing was changed." };
  }
  return { tone: "bad", text: designated ? "Designate refused." : "Undesignate refused." };
};
