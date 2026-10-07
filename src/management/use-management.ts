import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, request } from "../api/http";
import { type Scope, useSession } from "../auth/session";

export type Outcome = { tone: "ok" | "bad" | "unknown"; text: string };

/**
 * What a failed management call means. A server answer is shown as sent; no
 * answer at all leaves the outcome unknown, never success or failure.
 */
export const failure = (error: unknown): Outcome =>
  error instanceof ApiError
    ? { tone: "bad", text: error.message }
    : {
        tone: "unknown",
        text: "No answer from the server; the outcome is unknown until the next inspect.",
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
 * One management call per confirmed click; the client never retries or defers
 * mutations (main.tsx). A credential refusal hides the scope's controls for the
 * session, and
 * every settled call refreshes the environment reads so the screen shows the
 * server's state.
 */
export const useManagementCall = <T>(
  token: string,
  scope: Scope,
  describe: (result: T) => string,
) => {
  const queryClient = useQueryClient();
  const allowed = useSession((state) => !state.refused.includes(scope));
  const refuse = useSession((state) => state.refuse);
  const mutation = useMutation({
    mutationFn: (call: { path: string; body?: unknown }) =>
      request<T>(call.path, { token, method: "POST", body: call.body }),
    onError: (error) => {
      if (refusesCredential(error)) {
        refuse(token, scope);
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
      ? failure(mutation.error)
      : undefined;
  return { ...mutation, allowed, outcome };
};
