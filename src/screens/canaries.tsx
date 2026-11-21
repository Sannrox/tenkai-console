import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { CanaryDesignationResult } from "../api/tenkai.gen";
import { useAuthSession } from "../auth/identity";
import {
  canariesPath,
  chosenBy,
  designateBody,
  designateOutcome,
  fetchCanaries,
  type CanaryDesignation,
} from "../delivery/canaries";
import { at } from "../delivery/promotion-policies";
import { useManagementCall } from "../management/use-management";
import { Card, ConfirmButton, Notice } from "../ui/kit";
import { td, th } from "../ui/posture";
import { SelectorInput, useSelectorMatch } from "./selector-input";

const LOAD_TEXT = {
  unavailable: "This server does not report canary designations.",
  forbidden: "No access",
} as const;

const message = (result: CanaryDesignationResult) =>
  designateOutcome(result.designated, undefined).text;

/**
 * Designated canary environments on Releases: each row shows the environment,
 * the selector that chose it (or that it was named), and who set it. A
 * selector field reuses the server match preview; Designate and Undesignate
 * send that selector. Hidden writes without management. A lost answer reads
 * as unknown and is not resent.
 */
export const Canaries = ({ token }: { token: string }) => {
  const query = useQuery({
    queryKey: ["canaries", token],
    queryFn: () => fetchCanaries(token),
    retry: false,
  });
  const load = query.data;
  return (
    <section aria-label="Canary designations">
      <h2 className="mt-[18px] mb-2 text-[13px] font-semibold">Canary designations</h2>
      {load === undefined ? null : load.kind === "ok" ? (
        load.value.length === 0 ? (
          <p className="m-0 text-xs text-muted">No canary designations.</p>
        ) : (
          <Card className="overflow-x-auto">
            <table aria-label="Canary designations" className="w-full border-collapse text-xs">
              <thead>
                <tr>
                  <th className={th}>Environment</th>
                  <th className={th}>Chosen by</th>
                  <th className={th}>Set by</th>
                </tr>
              </thead>
              <tbody>
                {load.value.map((row) => (
                  <DesignationRow key={row.environment} row={row} />
                ))}
              </tbody>
            </table>
          </Card>
        )
      ) : (
        <p className="m-0 text-xs text-muted">
          {load.kind === "error" ? load.message : LOAD_TEXT[load.kind]}
        </p>
      )}
      {load?.kind === "ok" && <CanarySelector token={token} />}
    </section>
  );
};

const DesignationRow = ({ row }: { row: CanaryDesignation }) => (
  <tr className="[&:last-child>td]:border-b-0">
    <td className={`${td} font-mono`}>{row.environment}</td>
    <td className={`${td} whitespace-normal`}>{chosenBy(row)}</td>
    <td className={`${td} whitespace-normal`}>
      {row.set_by === undefined
        ? "·"
        : [row.set_by, row.set_at === undefined ? "" : `at ${at(row.set_at)}`]
            .filter(Boolean)
            .join(" ")}
    </td>
  </tr>
);

const CanarySelector = ({ token }: { token: string }) => {
  const call = useManagementCall(token, "fleet", "management", message);
  const me = useAuthSession(token);
  const permitted = call.allowed && me.data?.capabilities.includes("management") === true;
  const [text, setText] = useState("");
  const [verb, setVerb] = useState(true);
  const preview = useSelectorMatch(token, text);
  const matched = preview.match?.kind === "ok" ? preview.match.value : [];
  const ready = matched.length > 0 && !call.isPending;
  const outcome = call.isSuccess
    ? designateOutcome(verb, undefined)
    : call.error
      ? designateOutcome(verb, call.error)
      : undefined;
  if (!permitted) {
    return null;
  }
  const send = (designated: boolean) => {
    setVerb(designated);
    call.mutate({ path: canariesPath, body: designateBody(preview.selector, designated) });
  };
  return (
    <div className="mt-2 grid gap-2">
      <SelectorInput label="Canary selector" text={text} onChange={setText} {...preview} />
      <div className="flex flex-wrap items-center gap-2">
        <ConfirmButton
          label="Designate"
          confirm={`Designate ${matched.length} by ${preview.selector}`}
          disabled={!ready}
          onConfirm={() => send(true)}
        />
        <ConfirmButton
          label="Undesignate"
          confirm={`Undesignate ${matched.length} by ${preview.selector}`}
          disabled={!ready}
          onConfirm={() => send(false)}
        />
      </div>
      {outcome && <Notice tone={outcome.tone}>{outcome.text}</Notice>}
    </div>
  );
};
