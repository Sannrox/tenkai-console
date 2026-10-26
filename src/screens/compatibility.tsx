import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { request } from "../api/http";
import type { CompatibilityReport } from "../api/tenkai.gen";
import { isRefused, useSession } from "../auth/session";
import { isReleaseSpec } from "../management/catalog";
import {
  groupFailures,
  parseObservation,
  type Standing,
  standing,
} from "../management/compatibility";
import { failure, useManagementCall } from "../management/use-management";
import { Card, ConfirmButton, Notice } from "../ui/kit";

const th = "border-b border-line px-3.5 py-2 text-left font-medium whitespace-nowrap text-muted";
const td = "border-b border-line px-3.5 py-2 align-top";
const field =
  "min-w-0 rounded-md border border-field bg-white/4 px-2.5 py-1.5 font-mono text-xs text-fg placeholder:text-muted";
const STANDING: Record<Standing, { text: string; tone: string }> = {
  compatible: { text: "compatible", tone: "text-ok" },
  incompatible: { text: "incompatible", tone: "text-danger" },
  "no-profile": { text: "no profile", tone: "text-muted" },
};

/**
 * Compatibility of one release across environments (decision for #25,
 * variant B). Each environment is a row with its failures grouped by kind;
 * the selected environment's evidence is recorded in the side panel. Reports
 * name requirements only, never observed facts.
 */
export const Compatibility = ({
  token,
  environments,
}: {
  token: string;
  environments: string[];
}) => {
  const queryClient = useQueryClient();
  const refused = useSession((state) => state.refused);
  const [release, setRelease] = useState("");
  const [selected, setSelected] = useState<string>();
  const [evidence, setEvidence] = useState("");
  const [parseError, setParseError] = useState<string>();
  const spec = release.trim();
  const valid = isReleaseSpec(spec);
  const reports = useQueries({
    queries: environments.map((environment) => ({
      queryKey: ["compatibility", environment, spec, token],
      queryFn: () =>
        request<CompatibilityReport | null>(
          `v1/environments/${encodeURIComponent(environment)}/compatibility/${encodeURIComponent(spec)}`,
          { token },
        ),
      enabled: valid,
      retry: false,
    })),
  });
  const shown = selected ?? environments[0];
  const scope = `environment:${shown ?? ""}` as const;
  const record = useManagementCall<null>(token, scope, "management", () => "Evidence recorded.");
  const canRecord = shown !== undefined && !isRefused(refused, scope, "management");
  // The last submission's result, only while its environment is the one shown.
  const outcome = record.variables?.scope === scope ? record.outcome : undefined;

  const submit = () => {
    if (!shown) {
      return;
    }
    const parsed = parseObservation(evidence, shown);
    if (typeof parsed === "string") {
      setParseError(parsed);
      return;
    }
    setParseError(undefined);
    record.mutate(
      {
        path: `v1/environments/${encodeURIComponent(shown)}/compatibility/evidence`,
        body: parsed,
        // Bound to this environment: a refusal must not land on one selected later.
        scope: `environment:${shown}`,
      },
      {
        onSettled: () => {
          void queryClient.invalidateQueries({ queryKey: ["compatibility", shown] });
        },
      },
    );
  };

  return (
    <>
      <h2 className="mt-[18px] mb-2 text-[13px] font-semibold">Compatibility</h2>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input
          aria-label="Release to check"
          placeholder="product@version"
          value={release}
          onChange={(event) => setRelease(event.target.value)}
          className={field}
        />
        {spec && !valid && <span className="text-xs text-muted">product@version</span>}
      </div>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className={th}>Environment</th>
                <th className={th}>Status</th>
                <th className={th}>Failures</th>
              </tr>
            </thead>
            <tbody>
              {environments.map((environment, index) => {
                const query = reports[index];
                const report = query?.data;
                const state = report === undefined ? undefined : standing(report);
                return (
                  <tr
                    key={environment}
                    className={`[&:last-child>td]:border-b-0 ${
                      environment === shown ? "bg-selected" : ""
                    }`}
                  >
                    <td className={td}>
                      <button
                        type="button"
                        aria-pressed={environment === shown}
                        onClick={() => {
                          setSelected(environment);
                          setParseError(undefined);
                        }}
                        className="cursor-pointer font-semibold text-fg"
                      >
                        {environment}
                      </button>
                    </td>
                    <td className={td}>
                      {!valid ? (
                        <span className="text-muted">·</span>
                      ) : query?.error ? (
                        <span className="text-danger">{failure(query.error).text}</span>
                      ) : state ? (
                        <span className={STANDING[state].tone}>{STANDING[state].text}</span>
                      ) : (
                        <span className="text-muted">Loading</span>
                      )}
                    </td>
                    <td className={td}>
                      {report && report.failures.length > 0 ? (
                        groupFailures(report.failures).map((group) => (
                          <div key={group.kind} className="mb-1.5 last:mb-0">
                            <span className="block font-mono text-[11px] text-muted">
                              {group.kind}
                            </span>
                            {group.failures.map((item) => (
                              <span key={`${item.reason}:${item.subject ?? ""}`} className="block">
                                {item.subject && <span className="font-mono">{item.subject} </span>}
                                <span className="text-danger">{item.reason}</span>
                              </span>
                            ))}
                          </div>
                        ))
                      ) : (
                        <span className="text-muted">none</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
        {shown && !canRecord && outcome && (
          <Card className="p-3.5">
            <Notice tone={outcome.tone}>{outcome.text}</Notice>
          </Card>
        )}
        {shown && canRecord && (
          <Card className="p-3.5">
            <div className="mb-2 text-xs font-semibold">Evidence for {shown}</div>
            <textarea
              rows={8}
              aria-label="Compatibility evidence"
              placeholder="Paste the observation JSON, or choose a file"
              value={evidence}
              onChange={(event) => setEvidence(event.target.value)}
              className={`${field} w-full`}
            />
            <input
              type="file"
              accept="application/json,.json"
              aria-label="Evidence file"
              className="mt-2 block text-xs text-muted"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  void file.text().then(setEvidence);
                }
              }}
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <ConfirmButton
                label="Submit evidence"
                confirm={`Record evidence for ${shown}`}
                disabled={!evidence.trim() || record.isPending}
                onConfirm={submit}
              />
            </div>
            <div className="mt-2 grid gap-1">
              {parseError && <Notice tone="bad">{parseError}</Notice>}
              {outcome && <Notice tone={outcome.tone}>{outcome.text}</Notice>}
            </div>
          </Card>
        )}
      </div>
    </>
  );
};
