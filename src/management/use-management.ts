import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, request } from "../api/http";
import { type DeliveryCapability, isRefused, type Scope, useSession } from "../auth/session";

export type Outcome = { tone: "ok" | "bad" | "unknown"; text: string };

/**
 * What a failed management call means. A generic capability refusal is named
 * so the caller can see which grant was missing; any other server answer is
 * shown as sent. No answer at all leaves the outcome unknown.
 */
export const failure = (error: unknown, capability?: DeliveryCapability): Outcome => {
  if (!(error instanceof ApiError)) {
    return {
      tone: "unknown",
      text: "No answer from the server; the outcome is unknown until the next inspect.",
    };
  }
  const text =
    error.status === 403 && error.message === "insufficient delivery capability" && capability
      ? `missing ${capability} capability`
      : error.message;
  return { tone: "bad", text };
};

/**
 * Whether a refusal is about the credential rather than the request. Tenkai
 * also answers 403 to bad signatures, trust roots, and approvals, which a
 * corrected request can pass. These are its credential refusals; any other
 * 403 leaves the controls in place.
 */
export const refusesCredential = (error: unknown): boolean =>
  error instanceof ApiError &&
  error.status === 403 &&
  (error.message === "insufficient delivery capability" ||
    error.message === "invalid management credential" ||
    error.message.startsWith("environment-scoped credentials ") ||
    error.message.startsWith("runtime credentials "));

/**
 * A fresh identity for one click's request. `crypto.randomUUID` needs a
 * secure context, and the console may be served over plain http.
 */
export const newRequestId = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

/**
 * One management call, with its own request identity, per confirmed click; the client never retries or defers
 * mutations (main.tsx). A credential refusal hides that capability's controls
 * for the session, and every settled call refreshes the environment reads so
 * the screen shows the server's state.
 */
export const useManagementCall = <T>(
  token: string,
  scope: Scope,
  capability: DeliveryCapability,
  describe: (result: T) => string,
) => {
  const queryClient = useQueryClient();
  const allowed = useSession((state) => !isRefused(state.refused, scope, capability));
  const refuse = useSession((state) => state.refuse);
  const mutation = useMutation({
    mutationFn: (call: { path: string; body?: unknown }) =>
      request<T>(call.path, {
        token,
        method: "POST",
        body: call.body,
        requestId: newRequestId(),
      }),
    onError: (error) => {
      if (refusesCredential(error)) {
        refuse(token, scope, capability);
      }
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["environments"] }),
        queryClient.invalidateQueries({ queryKey: ["environment"] }),
      ]),
  });
  const outcome: Outcome | undefined = mutation.data
    ? { tone: "ok", text: describe(mutation.data) }
    : mutation.error
      ? failure(mutation.error, capability)
      : undefined;
  return { ...mutation, allowed, outcome };
};
