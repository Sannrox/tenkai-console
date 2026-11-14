import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { EnvironmentInspectReport } from "../api/tenkai.gen";
import { useAuthSession } from "../auth/identity";
import { isRefused, useSession } from "../auth/session";
import { holdBySelector } from "../management/selectors";
import { expectedGeneration } from "../plan/requests";
import { Button, ConfirmButton, Notice } from "../ui/kit";
import { SelectorInput, useSelectorMatch } from "./selector-input";

const field =
  "min-w-0 flex-1 basis-40 rounded-md border border-field bg-white/4 px-2.5 py-1.5 text-xs text-fg placeholder:text-muted";

/**
 * Hold every environment a selector matches, from the environment on screen
 * (Sannrox/tenkai#1278). The match is the server's preview; each hold
 * carries the selector, and the server records it with every environment it
 * resolved to. Results show per environment; a lost answer reads as unknown
 * and nothing is resent. Loaded lazily from the hold rows; hidden without
 * management, and once the environment on screen is held, except for the
 * results of the hold that held it.
 */
const SelectorHold = ({ report, token }: { report: EnvironmentInspectReport; token: string }) => {
  const allowed = useSession(
    (state) => !isRefused(state.refused, `environment:${report.name}`, "management"),
  );
  const grants = useAuthSession(token).data?.capabilities;
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [reason, setReason] = useState("");
  const preview = useSelectorMatch(token, text);
  const hold = useMutation({
    mutationFn: (environments: string[]) =>
      holdBySelector(
        {
          environments,
          selector: preview.selector,
          reason: reason.trim(),
          observed: { environment: report.name, generation: expectedGeneration(report.lease) },
        },
        token,
      ),
    onSettled: () =>
      Promise.all(
        ["environments", "fleet", "environment", "hold", "selector"].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      ),
  });
  if (
    !allowed ||
    (grants !== undefined && !grants.includes("management")) ||
    (report.delivery_hold && !hold.data)
  ) {
    return null;
  }
  const held = Boolean(report.delivery_hold);
  const matched = preview.match?.kind === "ok" ? preview.match.value : [];
  const includesThis = matched.includes(report.name);
  return (
    <>
      <dt className="text-muted">by selector</dt>
      <dd className="m-0 flex min-w-0 flex-col gap-1.5">
        {held ? null : !open ? (
          <span>
            <Button onClick={() => setOpen(true)}>Hold by selector</Button>
          </span>
        ) : (
          <>
            <SelectorInput label="Hold selector" text={text} onChange={setText} {...preview} />
            {preview.match?.kind === "ok" && matched.length > 0 && !includesThis && (
              <p className="m-0 text-xs text-warning">Does not match {report.name}.</p>
            )}
            <div className="flex flex-wrap gap-2">
              <input
                aria-label="Selector hold reason"
                placeholder="Reason to hold"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className={field}
              />
              <ConfirmButton
                label="Hold matches"
                confirm={`Hold ${matched.length} by ${preview.selector}`}
                disabled={hold.isPending || !includesThis || !reason.trim()}
                onConfirm={() => hold.mutate(matched)}
              />
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Close
              </Button>
            </div>
          </>
        )}
        {hold.data && (
          <ul aria-label="Selector hold results" className="m-0 list-none p-0">
            {hold.data.map((step) => (
              <li key={step.environment}>
                <Notice tone={step.outcome.tone}>{step.outcome.text}</Notice>
              </li>
            ))}
          </ul>
        )}
      </dd>
    </>
  );
};

export default SelectorHold;
