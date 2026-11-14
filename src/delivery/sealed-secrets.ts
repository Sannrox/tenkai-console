import { type } from "arktype";
import { ApiError, request } from "../api/http";
import { ageMs } from "./exposure";
import type { HealthTone } from "./instances";

// Only names, instance, age, and rotation fields. `digest`, `recipients`, and
// `sealed` are deleted at parse so no ciphertext or wrapped key is held.
const SealedSecretEntry = type({
  secret: "string",
  key: "string",
  instance: "string",
  "age_ms?": "number",
  "rotate_after?": "string",
  "overdue?": "boolean",
  set_at: "number",
  set_by: "string",
  "+": "delete",
});

const SealedSecretList = type({
  environment: "string",
  secrets: SealedSecretEntry.array(),
  "+": "delete",
});

export type SealedSecretEntry = typeof SealedSecretEntry.infer;

export type SealedSecretsLoad =
  | { kind: "ok"; value: SealedSecretEntry[] }
  | { kind: "unavailable" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string };

/**
 * Read an environment's sealed secret list. Older servers have no route
 * (404/405); 403 is no permission.
 */
export const fetchSealedSecrets = async (
  environment: string,
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<SealedSecretsLoad> => {
  let raw: unknown;
  try {
    raw = await request<unknown>(
      `v1/environments/${encodeURIComponent(environment)}/sealed-secrets`,
      { token },
      fetcher,
    );
  } catch (error) {
    if (!(error instanceof ApiError)) {
      return { kind: "error", message: "Could not load" };
    }
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
  }
  const value = SealedSecretList(raw);
  return value instanceof type.errors
    ? { kind: "error", message: "Could not load" }
    : { kind: "ok", value: value.secrets };
};

export type SecretRow = {
  name: string;
  instance: string;
  age: string;
  rotateAfter: string;
  state: "overdue" | "within age" | "no rotation";
  tone: HealthTone;
  setBy: string;
};

const stateOf = (entry: SealedSecretEntry): Pick<SecretRow, "state" | "tone"> => {
  if (entry.overdue === true) {
    return { state: "overdue", tone: "warn" };
  }
  return entry.rotate_after === undefined
    ? { state: "no rotation", tone: "muted" }
    : { state: "within age", tone: "ok" };
};

/** One row per instance value, overdue first, then by name and instance. */
export const secretRows = (entries: readonly SealedSecretEntry[]): SecretRow[] =>
  entries
    .map((entry) => ({
      name: `${entry.secret}/${entry.key}`,
      instance: entry.instance,
      age: entry.age_ms === undefined ? "n/a" : ageMs(entry.age_ms),
      rotateAfter: entry.rotate_after ?? "none",
      setBy: entry.set_by,
      ...stateOf(entry),
    }))
    .toSorted(
      (left, right) =>
        Number(right.state === "overdue") - Number(left.state === "overdue") ||
        left.name.localeCompare(right.name) ||
        left.instance.localeCompare(right.instance),
    );
