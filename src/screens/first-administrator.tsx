import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { ApiError, request } from "../api/http";
import type { CreateGrantRuleRequest, GrantRuleList, ServiceStatus } from "../api/tenkai.gen";
import { Button, Notice } from "../ui/kit";

/**
 * First-run banner and form (#40, decision C1). While `/healthz` reports no
 * first administrator, every signed-in screen shows a banner; its Set up
 * opens a form that stores a grant rule giving the named group read and
 * management (`/v1/grant-rules`, Sannrox/tenkai#837).
 *
 * The break-glass management token is the authority, whoever is signed in:
 * it is pasted once, sent as the credential for this one submission only,
 * and cleared from state as soon as the submission starts. It never reaches
 * the query cache or storage.
 */

const field =
  "min-w-0 rounded-md border border-field bg-white/4 px-2 py-1 text-xs text-fg placeholder:text-muted";

/** The capabilities the first administrator group gets; not editable. */
export const FIRST_ADMIN_CAPABILITIES = ["read", "management"];

/** The create request for `value`, at the listed `generation`. */
export const firstAdminRequest = (
  value: string,
  reason: string,
  generation: number,
): CreateGrantRuleRequest => ({
  rule: { value: value.trim(), capabilities: FIRST_ADMIN_CAPABILITIES },
  reason: reason.trim(),
  generation,
});

/**
 * List the stored rules for their generation, then create the rule; both
 * with `token` as the only credential.
 */
export const createFirstAdministrator = async (
  token: string,
  value: string,
  reason: string,
): Promise<void> => {
  const { generation } = await request<GrantRuleList>("v1/grant-rules", { token });
  await request<GrantRuleList>("v1/grant-rules", {
    token,
    method: "POST",
    body: firstAdminRequest(value, reason, generation),
  });
};

type Outcome = { tone: "ok" | "bad"; text: string };

export const FirstAdministratorBanner = () => {
  const queryClient = useQueryClient();
  const health = useQuery({
    queryKey: ["health"],
    queryFn: () => request<ServiceStatus>("healthz"),
    retry: false,
  });
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [token, setToken] = useState("");
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>();

  if (health.data?.first_administrator !== "missing" && outcome?.tone !== "ok") {
    return null;
  }
  const ready = !pending && value.trim() !== "" && reason.trim() !== "" && token !== "";
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready) {
      return;
    }
    // Taken out of state before the request: never kept, whatever happens.
    const credential = token;
    setToken("");
    setPending(true);
    setOutcome(undefined);
    try {
      await createFirstAdministrator(credential, value, reason);
      setOutcome({
        tone: "ok",
        text: `Grant created. Members of ${value.trim()} can manage this hub after they sign in again.`,
      });
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["health"] });
    } catch (caught) {
      setOutcome({
        tone: "bad",
        text:
          caught instanceof ApiError && caught.status === 401
            ? "The management token was not accepted."
            : caught instanceof Error
              ? caught.message
              : "The grant was not created.",
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <section
      aria-label="First administrator"
      className="mb-4 border-l-2 border-warning py-1 pl-2 text-xs"
    >
      {outcome?.tone === "ok" ? (
        <Notice tone="ok">{outcome.text}</Notice>
      ) : (
        <p className="m-0">
          No first administrator: no sign-in group can manage this hub.{" "}
          {!open && (
            <Button variant="ghost" className="px-1 py-0 underline" onClick={() => setOpen(true)}>
              Set up
            </Button>
          )}
        </p>
      )}
      {open && (
        <form
          aria-label="Set up the first administrator group"
          className="mt-2 max-w-xl"
          onSubmit={(event) => void submit(event)}
        >
          <p className="m-0 mb-1 font-semibold">Set up the first administrator group</p>
          <label className="mb-1 block">
            <span className="text-muted">
              Group (claim value from the server's OIDC grants claim)
            </span>
            <input
              aria-label="Group"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="tenkai-admins"
              className={`${field} block w-full font-mono`}
            />
          </label>
          <p className="m-0 mb-1">
            <span className="text-muted">Capabilities</span>{" "}
            <span className="font-mono">{FIRST_ADMIN_CAPABILITIES.join(", ")}</span>
          </p>
          <label className="mb-1 block">
            <span className="text-muted">Reason</span>
            <input
              aria-label="Reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Initial administrator group"
              className={`${field} block w-full`}
            />
          </label>
          <label className="mb-2 block">
            <span className="text-muted">Management token</span>
            <input
              aria-label="Management token"
              type="password"
              autoComplete="off"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              className={`${field} block w-full font-mono`}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="primary" disabled={!ready}>
              Create grant
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false);
                setToken("");
              }}
            >
              Cancel
            </Button>
            <span className="text-muted">
              The token is used for this request only and not kept.
            </span>
          </div>
          {outcome?.tone === "bad" && (
            <div className="mt-2">
              <Notice tone="bad">{outcome.text}</Notice>
            </div>
          )}
        </form>
      )}
    </section>
  );
};
