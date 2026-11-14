import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import type { ManagementLifecycleResult } from "../api/tenkai.gen";
import { useAuthSession } from "../auth/identity";
import { ageMs } from "../delivery/exposure";
import {
  at,
  evidenceLine,
  fetchPolicyView,
  pauseBody,
  pauseOutcome,
  policyPath,
  promotedBy,
  resetCause,
  share,
  soakLine,
  type PolicyView,
} from "../delivery/promotion-policies";
import { useManagementCall } from "../management/use-management";
import { Card, ConfirmButton, Notice } from "../ui/kit";

const LOAD_TEXT = {
  unavailable: "This server does not report policy detail.",
  forbidden: "No access",
} as const;

const message = (result: ManagementLifecycleResult) => result.message;

/**
 * One promotion policy: rules, pause actor, and the soaking release. Pause
 * and resume are catalog-wide management writes, offered only when
 * `/v1/auth/me` grants management and no credential refusal hid them. Each
 * confirmed click is one request; a lost answer reads as unknown and is
 * never resent.
 */
export const PolicyDetail = ({
  token,
  product,
  channel,
}: {
  token: string;
  product: string;
  channel: string;
}) => {
  const query = useQuery({
    queryKey: ["promotion-policy", token, product, channel],
    queryFn: () => fetchPolicyView(product, channel, token),
    retry: false,
  });
  const call = useManagementCall(token, "fleet", "management", message);
  const me = useAuthSession(token);
  const permitted = call.allowed && me.data?.capabilities.includes("management") === true;
  const [verb, setVerb] = useState<"pause" | "resume">("pause");
  const outcome = call.isSuccess
    ? pauseOutcome(verb, undefined)
    : call.error
      ? pauseOutcome(verb, call.error)
      : undefined;
  const load = query.data;
  return (
    <section aria-label="Policy detail" className="mt-2">
      {load === undefined ? null : load.kind === "ok" ? (
        <Card className="px-3.5 py-3 text-xs">
          <Rules view={load.value} />
          {permitted && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <ConfirmButton
                label={load.value.paused ? "Resume" : "Pause"}
                confirm={`${load.value.paused ? "Resume" : "Pause"} ${product} ${load.value.source_channel} -> ${channel} policy`}
                disabled={call.isPending}
                onConfirm={() => {
                  const next = load.value.paused ? "resume" : "pause";
                  setVerb(next);
                  call.mutate({ path: policyPath(product, channel, next), body: pauseBody(next) });
                }}
              />
            </div>
          )}
        </Card>
      ) : (
        <p className="m-0 text-xs text-muted">
          {load.kind === "error" ? load.message : LOAD_TEXT[load.kind]}
        </p>
      )}
      {outcome && (
        <div className="mt-2">
          <Notice tone={outcome.tone}>{outcome.text}</Notice>
        </div>
      )}
    </section>
  );
};

const Item = ({
  label,
  children,
  tone = "",
}: {
  label: string;
  children: ReactNode;
  tone?: string;
}) => (
  <>
    <dt className="text-muted">{label}</dt>
    <dd className={`m-0 min-w-0 break-words ${tone}`}>{children}</dd>
  </>
);

const Rules = ({ view }: { view: PolicyView }) => {
  const promoted = promotedBy(view);
  return (
    <dl aria-label="Policy rules" className="m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
      <Item label="Policy">
        <span className="font-mono">
          {view.policy_id} v{view.policy_version}
        </span>
      </Item>
      <Item label="Minimum soak">{ageMs(view.soak_duration_ms)}</Item>
      <Item label="Evidence">{evidenceLine(view.evidence)}</Item>
      <Item label="Paused" tone={view.paused ? "text-warning" : ""}>
        {view.paused
          ? [
              "by",
              view.paused_by ?? "unknown",
              view.paused_at === undefined ? "" : `at ${at(view.paused_at)}`,
            ]
              .filter(Boolean)
              .join(" ")
          : "no"}
      </Item>
      {view.soaking_release !== undefined && (
        <Item label="Soaking">
          <span className="font-mono">{view.soaking_release}</span> · {soakLine(view)}
          {view.healthy_share !== undefined && ` · healthy ${share(view.healthy_share)}`}
          {view.failing_share !== undefined && ` · failing ${share(view.failing_share)}`}
        </Item>
      )}
      {view.last_reset_cause !== undefined && (
        <Item label="Last reset" tone="text-danger">
          {view.last_reset_at === undefined ? "" : `${at(view.last_reset_at)} · `}
          {resetCause(view.last_reset_cause)}
        </Item>
      )}
      {promoted !== undefined && (
        <Item label="Promoted by">
          <span className="font-mono">{promoted}</span>
        </Item>
      )}
    </dl>
  );
};

export default PolicyDetail;
