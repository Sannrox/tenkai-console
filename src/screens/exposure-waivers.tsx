import { useEffect, useState } from "react";
import type {
  ManagementLifecycleResult,
  MatchedExposure,
  WaiverCategory,
  WaiverScopeKind,
} from "../api/tenkai.gen";
import { useAuthSession } from "../auth/identity";
import {
  WAIVER_CATEGORIES,
  WAIVER_SCOPES,
  inGrace,
  minuteUtc,
  scopeLabel,
  scopeTarget,
  waiverClearBody,
  waiverLine,
  waiverSetBody,
  waiverState,
} from "../delivery/waivers";
import { useManagementCall } from "../management/use-management";
import { Button, Card, ConfirmButton, Notice } from "../ui/kit";
import { td, th } from "../ui/posture";

const field =
  "min-w-0 rounded-md border border-field bg-white/4 px-2.5 py-1.5 font-mono text-xs text-fg placeholder:text-muted";

const matchKey = (match: MatchedExposure): string =>
  `${match.advisory_id}|${match.release_id}|${match.component}`;

const describe = (result: ManagementLifecycleResult): string => result.message;

/**
 * Advisory-feed matches with their waiver (#121) and the environments still
 * within grace, with the server's grace end (#164). Waive and remove are
 * catalog-wide management writes: hidden when `/v1/auth/me` lacks management
 * or after a credential refusal, confirmed once per send, never retried.
 */
export const Findings = ({ token, matches }: { token: string; matches: MatchedExposure[] }) => {
  const set = useManagementCall(token, "fleet", "management", describe);
  const clear = useManagementCall(token, "fleet", "management", describe);
  const me = useAuthSession(token);
  const grants = me.data?.capabilities;
  const permitted =
    set.allowed && !me.isPending && (grants === undefined || grants.includes("management"));
  const [selected, setSelected] = useState<string>();
  const [now, setNow] = useState(() => Date.now());
  // Re-reads the clock so a waiver that expires while the screen is open stops marking its finding.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(tick);
  }, []);
  const pending = set.isPending || clear.isPending;
  const chosen = permitted ? matches.find((match) => matchKey(match) === selected) : undefined;
  return (
    <section aria-label="Findings">
      <h2 className="mt-[18px] mb-2 text-[13px] font-semibold">Findings</h2>
      <Card className="overflow-x-auto">
        <table aria-label="Findings" className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className={th}>Advisory</th>
              <th className={th}>Severity</th>
              <th className={th}>Release</th>
              <th className={th}>Component</th>
              <th className={th}>Grace</th>
              <th className={th}>Waiver</th>
              {permitted && <th className={th} aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {matches.length === 0 ? (
              <tr>
                <td className={`${td} text-muted`} colSpan={permitted ? 7 : 6}>
                  no findings
                </td>
              </tr>
            ) : (
              matches.map((match) => {
                const state = waiverState(match.waiver, now);
                const key = matchKey(match);
                const grace = inGrace(match.grace);
                return (
                  <tr key={key}>
                    <td className={`${td} font-mono`}>{match.advisory_id}</td>
                    <td className={td}>{match.severity}</td>
                    <td className={`${td} font-mono`}>{match.release}</td>
                    <td className={`${td} font-mono`}>
                      {match.component} {match.component_version}
                    </td>
                    <td className={td}>
                      {grace.length === 0 ? (
                        <span className="text-muted">·</span>
                      ) : (
                        grace.map((entry) => (
                          <div key={entry.environment}>
                            {entry.environment} until {minuteUtc(entry.grace_ends_at)}
                          </div>
                        ))
                      )}
                    </td>
                    <td className={`${td} ${state === "expiring" ? "text-warning" : ""}`}>
                      {state === "none" || match.waiver === undefined ? (
                        <span className="text-muted">none</span>
                      ) : (
                        <>
                          <div>
                            {state === "expiring" && "expiring soon · "}
                            {waiverLine(match.waiver)}
                          </div>
                          <div className="text-muted">{match.waiver.reason}</div>
                        </>
                      )}
                    </td>
                    {permitted && (
                      <td className={td}>
                        <Button
                          variant="ghost"
                          disabled={pending}
                          onClick={() => setSelected(selected === key ? undefined : key)}
                        >
                          {state === "none" ? "Waive" : "Remove"}
                        </Button>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </Card>
      {chosen &&
        (waiverState(chosen.waiver, now) === "none" || chosen.waiver === undefined ? (
          <WaiveForm
            key={matchKey(chosen)}
            match={chosen}
            pending={pending}
            onSend={(body) =>
              set.mutate(
                { path: "v1/exposures/waivers", body },
                { onSuccess: () => setSelected(undefined) },
              )
            }
          />
        ) : (
          <RemoveForm
            key={matchKey(chosen)}
            global={chosen.waiver.scope === "global"}
            confirm={`Remove ${chosen.waiver.scope} waiver on ${chosen.advisory_id}`}
            pending={pending}
            onSend={(reason) =>
              chosen.waiver &&
              clear.mutate(
                {
                  path: "v1/exposures/waivers/clear",
                  body: waiverClearBody(chosen.waiver, reason),
                },
                { onSuccess: () => setSelected(undefined) },
              )
            }
          />
        ))}
      <div className="mt-2 flex flex-wrap gap-2">
        {set.outcome && <Notice tone={set.outcome.tone}>{set.outcome.text}</Notice>}
        {clear.outcome && <Notice tone={clear.outcome.tone}>{clear.outcome.text}</Notice>}
      </div>
    </section>
  );
};

/** A global waiver covers every product, so it needs a second, explicit acknowledgement. */
const GlobalAck = ({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) => (
  <label className="flex items-center gap-1.5 text-xs">
    <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    Applies to every product
  </label>
);

const WaiveForm = ({
  match,
  pending,
  onSend,
}: {
  match: MatchedExposure;
  pending: boolean;
  onSend: (body: ReturnType<typeof waiverSetBody>) => void;
}) => {
  const [scope, setScope] = useState<WaiverScopeKind>("release");
  const [category, setCategory] = useState<WaiverCategory>("false_positive");
  const [reason, setReason] = useState("");
  const [expires, setExpires] = useState("7d");
  const [ack, setAck] = useState(false);
  const ready = reason.trim() !== "" && expires.trim() !== "" && (scope !== "global" || ack);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <select
        aria-label="Waiver scope"
        value={scope}
        onChange={(event) => {
          setScope(WAIVER_SCOPES.find((value) => value === event.target.value) ?? "release");
          setAck(false);
        }}
        className={field}
      >
        {WAIVER_SCOPES.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
      <select
        aria-label="Waiver category"
        value={category}
        onChange={(event) =>
          setCategory(
            WAIVER_CATEGORIES.find((value) => value === event.target.value) ?? "false_positive",
          )
        }
        className={field}
      >
        {WAIVER_CATEGORIES.map((value) => (
          <option key={value} value={value}>
            {value.replaceAll("_", " ")}
          </option>
        ))}
      </select>
      <input
        aria-label="Waiver reason"
        placeholder="Reason"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        className={field}
      />
      <input
        aria-label="Waiver expires"
        placeholder="7d or RFC3339"
        value={expires}
        onChange={(event) => setExpires(event.target.value)}
        className={`${field} w-32`}
      />
      {scope === "global" && <GlobalAck checked={ack} onChange={setAck} />}
      <ConfirmButton
        label="Waive"
        confirm={`Waive ${match.advisory_id} for ${scopeLabel(scope, scopeTarget(scope, match))} until ${expires.trim()}`}
        disabled={!ready || pending}
        onConfirm={() => onSend(waiverSetBody(match, { scope, category, reason, expires }))}
      />
    </div>
  );
};

const RemoveForm = ({
  global,
  confirm,
  pending,
  onSend,
}: {
  global: boolean;
  confirm: string;
  pending: boolean;
  onSend: (reason: string) => void;
}) => {
  const [reason, setReason] = useState("");
  const [ack, setAck] = useState(false);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <input
        aria-label="Removal reason"
        placeholder="Reason"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        className={field}
      />
      {global && <GlobalAck checked={ack} onChange={setAck} />}
      <ConfirmButton
        label="Remove waiver"
        confirm={confirm}
        disabled={reason.trim() === "" || (global && !ack) || pending}
        onConfirm={() => onSend(reason)}
      />
    </div>
  );
};
