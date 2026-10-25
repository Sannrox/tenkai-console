import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, request } from "../api/http";
import type {
  ApprovalEnvelope,
  MigrationListEntry,
  PackageMigrationResult,
} from "../api/tenkai.gen";
import { isRefused, useSession } from "../auth/session";
import {
  applyBody,
  checkpointRows,
  describeMigration,
  listMigrations,
  mutateBody,
  parseDeclaration,
  parseGeneration,
  parseMigrationEvidence,
  parsePlanApproval,
  pendingPlan,
  pinLine,
  previewBody,
  shortPlan,
  statusTone,
} from "../management/migrations";
import { useManagementCall } from "../management/use-management";
import { Button, Card, ConfirmButton, Notice } from "../ui/kit";

const th = "border-b border-line px-3.5 py-2 text-left font-medium whitespace-nowrap text-muted";
const td = "border-b border-line px-3.5 py-2 align-top";
const field =
  "min-w-0 rounded-md border border-field bg-white/4 px-2.5 py-1.5 font-mono text-xs text-fg placeholder:text-muted";
const TONE = {
  ok: "text-ok",
  warning: "text-warning",
  danger: "text-danger",
  muted: "text-muted",
} as const;

/**
 * Package migrations on Releases (decision 4D). Create (preview, then apply)
 * sits above the stored list; resume and rollback stay on the selected row.
 * The browser never signs: declaration, approval, and trust roots are pasted.
 */
export const Migrations = ({ token, environments }: { token: string; environments: string[] }) => {
  const refused = useSession((state) => state.refused);
  const list = useQuery({
    queryKey: ["migrations", token],
    queryFn: () => listMigrations(token),
    retry: false,
  });
  const [selected, setSelected] = useState<string>();
  const [name, setName] = useState("");
  const [environment, setEnvironment] = useState("");
  const [generation, setGeneration] = useState("0");
  const [backup, setBackup] = useState("");
  const [declarationText, setDeclarationText] = useState("");
  const [approvalText, setApprovalText] = useState("");
  const [rootsText, setRootsText] = useState("");
  const [planText, setPlanText] = useState("");
  const [parseError, setParseError] = useState<string>();
  const [followStored, setFollowStored] = useState(false);
  const env = environment.trim();
  const migration = name.trim();
  const envScope = `environment:${env}` as const;
  const preview = useManagementCall(token, envScope, "read", describeMigration);
  const manage = useManagementCall(token, envScope, "management", describeMigration);
  const rows = list.data ?? [];
  const shown = selected ?? rows[0]?.name;
  const selectRow = (row: MigrationListEntry) => {
    setSelected(row.name);
    setName(row.name);
    setEnvironment(row.environment);
    setFollowStored(true);
    if (row.name !== shown) {
      setPlanText("");
    }
  };
  const detail = useQuery({
    queryKey: ["migration", shown, token],
    queryFn: () =>
      request<PackageMigrationResult>(`v1/migrations/${encodeURIComponent(shown ?? "")}`, {
        token,
      }),
    enabled: Boolean(shown),
    retry: false,
  });
  const latestCall = preview.submittedAt >= manage.submittedAt ? preview : manage;
  const stored = shown && detail.data?.record.name === shown ? detail.data.record : undefined;
  const previewed =
    !followStored &&
    preview.submittedAt >= manage.submittedAt &&
    preview.data &&
    preview.data.record.name === shown
      ? preview.data.record
      : undefined;
  const record =
    previewed ??
    stored ??
    (manage.data && manage.data.record.name === shown ? manage.data.record : undefined);
  const pending = stored ? pendingPlan(stored) : record ? pendingPlan(record) : undefined;
  const canManage = (target: string) => !isRefused(refused, `environment:${target}`, "management");
  const canPreview = env ? !isRefused(refused, envScope, "read") : true;
  const formManage = env ? canManage(env) : true;

  const parsedGeneration = parseGeneration(generation);
  const send = (verb: "preview" | "apply" | "resume" | "rollback", row?: MigrationListEntry) => {
    const targetName = row?.name ?? migration;
    const targetEnv = row?.environment ?? env;
    if (!targetName || !targetEnv) {
      setParseError("Name and environment are required.");
      return;
    }
    if (typeof parsedGeneration === "string") {
      setParseError(parsedGeneration);
      return;
    }
    const declaration =
      verb === "preview" || verb === "apply" ? parseDeclaration(declarationText) : undefined;
    if (typeof declaration === "string") {
      setParseError(declaration);
      return;
    }
    const evidence =
      verb === "preview" ? undefined : parseMigrationEvidence(targetEnv, approvalText, rootsText);
    if (typeof evidence === "string") {
      setParseError(evidence);
      return;
    }
    const pendingForTarget =
      (stored?.name === targetName ? pendingPlan(stored) : undefined) ??
      (record?.name === targetName ? pending : undefined);
    let planApproval: ApprovalEnvelope | undefined;
    if (planText.trim() && pendingForTarget) {
      const parsed = parsePlanApproval(planText);
      if (typeof parsed === "string") {
        setParseError(parsed);
        return;
      }
      planApproval = parsed;
    }
    setParseError(undefined);
    setFollowStored(false);
    const encoded = encodeURIComponent(targetName);
    const scope = `environment:${targetEnv}` as const;
    if (verb === "preview" && declaration) {
      preview.mutate({
        path: `v1/migrations/${encoded}/preview`,
        body: previewBody(targetEnv, declaration, backup),
        scope,
      });
      setSelected(targetName);
      return;
    }
    if (verb === "apply" && declaration && evidence) {
      manage.mutate({
        path: `v1/migrations/${encoded}/apply`,
        body: applyBody(
          targetEnv,
          parsedGeneration,
          declaration,
          evidence,
          backup,
          pendingForTarget,
          planApproval,
        ),
        scope,
      });
      setSelected(targetName);
      return;
    }
    if ((verb === "resume" || verb === "rollback") && evidence) {
      manage.mutate({
        path: `v1/migrations/${encoded}/${verb}`,
        body: mutateBody(parsedGeneration, evidence, pendingForTarget, planApproval),
        scope,
      });
      setSelected(targetName);
    }
  };

  const missing = detail.error instanceof ApiError && detail.error.status === 404;
  const outcome =
    preview.submittedAt === 0 && manage.submittedAt === 0 ? undefined : latestCall.outcome;
  const pendingBusy = preview.isPending || manage.isPending;

  return (
    <>
      <h2 className="mt-[18px] mb-2 text-[13px] font-semibold">Migrations</h2>
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label="Migration name"
          placeholder="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={field}
        />
        <input
          aria-label="Migration environment"
          placeholder="Environment"
          list="migration-environments"
          value={environment}
          onChange={(event) => setEnvironment(event.target.value)}
          className={field}
        />
        <datalist id="migration-environments">
          {environments.map((item) => (
            <option key={item} value={item} />
          ))}
        </datalist>
        <input
          aria-label="Expected generation"
          placeholder="Generation"
          value={generation}
          onChange={(event) => setGeneration(event.target.value)}
          className={field}
        />
        <input
          aria-label="Backup receipt digest"
          placeholder="Backup digest"
          value={backup}
          onChange={(event) => setBackup(event.target.value)}
          className={field}
        />
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <textarea
          rows={6}
          aria-label="Migration declaration"
          placeholder="Paste declaration JSON"
          value={declarationText}
          onChange={(event) => setDeclarationText(event.target.value)}
          className={field}
        />
        <div className="grid gap-3">
          <textarea
            rows={3}
            aria-label="Migration approval"
            placeholder="Paste approval JSON"
            value={approvalText}
            onChange={(event) => setApprovalText(event.target.value)}
            className={field}
          />
          <textarea
            rows={3}
            aria-label="Migration trust roots"
            placeholder="Paste trust-roots TOML"
            value={rootsText}
            onChange={(event) => setRootsText(event.target.value)}
            className={field}
          />
        </div>
      </div>
      {pending && (
        <textarea
          rows={4}
          aria-label="Plan approval"
          placeholder={`Paste plan approval JSON for ${shortPlan(pending)}`}
          value={planText}
          onChange={(event) => setPlanText(event.target.value)}
          className={`${field} mt-3 w-full`}
        />
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {canPreview && (
          <Button
            disabled={!migration || !env || !declarationText || pendingBusy}
            onClick={() => send("preview")}
          >
            Preview
          </Button>
        )}
        {formManage && (
          <ConfirmButton
            label="Apply"
            confirm={`Apply ${migration} on ${env} at generation ${typeof parsedGeneration === "number" ? parsedGeneration : generation}`}
            disabled={
              !migration || !env || !declarationText || !approvalText || !rootsText || pendingBusy
            }
            onConfirm={() => send("apply")}
          />
        )}
      </div>
      <div className="mt-2 grid gap-1">
        {parseError && <Notice tone="bad">{parseError}</Notice>}
        {outcome && <Notice tone={outcome.tone}>{outcome.text}</Notice>}
      </div>

      {list.error ? (
        <p role="alert" className="mt-3 text-xs text-danger">
          {list.error.message}
        </p>
      ) : (
        <Card className="mt-3 overflow-x-auto">
          {list.isPending ? (
            <p className="m-0 px-3.5 py-2 text-xs text-muted">Loading</p>
          ) : (
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr>
                  <th className={th}>Name</th>
                  <th className={th}>Environment</th>
                  <th className={th}>Status</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const active = row.name === shown;
                  const pendingLabel =
                    active && record && pendingPlan(record)
                      ? ` · ${shortPlan(pendingPlan(record) ?? "")}`
                      : "";
                  return (
                    <tr
                      key={row.id}
                      aria-selected={active}
                      tabIndex={0}
                      onClick={() => selectRow(row)}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) {
                          return;
                        }
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          selectRow(row);
                        }
                      }}
                      className={`cursor-pointer [&:last-child>td]:border-b-0 ${active ? "bg-selected" : ""}`}
                    >
                      <td className={`${td} font-semibold`}>{row.name}</td>
                      <td className={td}>{row.environment}</td>
                      <td className={`${td} ${TONE[statusTone(row.status)]}`}>
                        {row.status}
                        {pendingLabel}
                      </td>
                      <td className={td}>
                        {active && canManage(row.environment) && (
                          <div
                            className="flex flex-wrap gap-2"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <ConfirmButton
                              label="Resume"
                              confirm={`Resume ${row.name} on ${row.environment} at generation ${typeof parsedGeneration === "number" ? parsedGeneration : generation}`}
                              disabled={!approvalText || !rootsText || pendingBusy}
                              onConfirm={() => send("resume", row)}
                            />
                            <ConfirmButton
                              label="Roll back"
                              confirm={`Roll back ${row.name} on ${row.environment} at generation ${typeof parsedGeneration === "number" ? parsedGeneration : generation}`}
                              disabled={!approvalText || !rootsText || pendingBusy}
                              onConfirm={() => send("rollback", row)}
                            />
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {!missing && detail.error && (
        <p role="alert" className="mt-3 text-xs text-danger">
          {detail.error.message}
        </p>
      )}
      {record && (
        <Detail
          record={record}
          missing={missing}
          storedStatus={previewed && stored ? stored.status : undefined}
        />
      )}
    </>
  );
};

const Detail = ({
  record,
  missing,
  storedStatus,
}: {
  record: NonNullable<PackageMigrationResult["record"]>;
  missing: boolean;
  storedStatus: string | undefined;
}) => {
  const pending = pendingPlan(record);
  const rows = checkpointRows(record);
  return (
    <>
      <div className="mt-[18px] mb-2 text-[13px] font-semibold">
        {record.name} · {record.environment} · fence {record.fence_generation}
        {pending && (
          <span className="ml-2 font-medium text-warning">pending plan {shortPlan(pending)}</span>
        )}
      </div>
      {missing && <p className="mb-2 text-xs text-muted">Not stored yet; this is the preview.</p>}
      {storedStatus && (
        <p className="mb-2 text-xs text-muted">Preview. Stored status is {storedStatus}.</p>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <dl className="m-0 grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 px-3.5 py-3 text-xs">
            <dt className="text-muted">status</dt>
            <dd className={`m-0 ${TONE[statusTone(record.status)]}`}>{record.status}</dd>
            <dt className="text-muted">source</dt>
            <dd className="m-0 font-mono break-all">{pinLine(record.declaration.source)}</dd>
            <dt className="text-muted">target</dt>
            <dd className="m-0 font-mono break-all">{pinLine(record.declaration.target)}</dd>
            <dt className="text-muted">compatibility</dt>
            <dd className="m-0">{record.declaration.compatibility.status}</dd>
            <dt className="text-muted">approval</dt>
            <dd className="m-0 font-mono break-all">{record.approval_digest}</dd>
            <dt className="text-muted">backup</dt>
            <dd className="m-0 font-mono break-all">{record.backup_receipt_digest ?? "none"}</dd>
          </dl>
        </Card>
        <Card className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className={th}>Checkpoint</th>
                <th className={th}>Class</th>
                <th className={th}>Result</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="[&:last-child>td]:border-b-0">
                  <td className={td}>{row.id}</td>
                  <td className={td}>{row.class}</td>
                  <td
                    className={`${td} ${row.waiting ? "text-warning" : row.result === "not started" ? "text-muted" : "text-ok"}`}
                  >
                    {row.result}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  );
};
