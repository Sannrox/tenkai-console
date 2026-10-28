import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { download, request } from "../api/http";
import type {
  BackupManifest,
  BackupStatus,
  ExportEntry,
  ExportKind,
  ExportList,
  ServiceStatus,
} from "../api/tenkai.gen";
import { useSession } from "../auth/session";
import {
  EXPORT_KINDS,
  exportRequest,
  historyRows,
  size,
  type ExportFields,
} from "../delivery/operations";
import { age } from "../delivery/runners";
import { failure, useManagementCall, type Outcome } from "../management/use-management";
import { Button, Card, ConfirmButton, Notice } from "../ui/kit";
import { RefreshFailed, td, th } from "../ui/posture";

const field =
  "min-w-0 rounded-md border border-field bg-white/4 px-2.5 py-1.5 text-xs text-fg placeholder:text-muted";

const BACKUP_TONE: Record<string, string> = {
  ok: "text-ok",
  stale: "text-warning",
  missing: "text-warning",
  unreadable: "text-danger",
};

const iso = (ms: number) => new Date(ms).toISOString();

/**
 * The 2026-10-28 pick A (#37): Backups, Exports and Export history stacked,
 * as a top-level tab (#34). Downloads go through the authenticated client;
 * no token or artifact is kept.
 */
export const Operations = () => {
  const token = useSession((state) => state.session?.accessToken);
  const health = useQuery({
    queryKey: ["health"],
    queryFn: () => request<ServiceStatus>("healthz"),
    retry: false,
  });
  const backups = useQuery({
    queryKey: ["backups", token],
    queryFn: () => request<BackupStatus>("v1/backups", { token }),
    enabled: token !== undefined,
    retry: false,
  });
  const exports = useQuery({
    queryKey: ["exports", token],
    queryFn: () => request<ExportList>("v1/exports", { token }),
    enabled: token !== undefined,
    retry: false,
  });
  if (token === undefined) {
    return null;
  }
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="m-0 text-lg font-semibold">Operations</h1>
        <Button
          variant="ghost"
          className="ml-auto"
          onClick={() => void Promise.all([health.refetch(), backups.refetch(), exports.refetch()])}
        >
          Refresh
        </Button>
      </div>
      <RefreshFailed
        queries={[
          ["health", health],
          ["backups", backups],
          ["exports", exports],
        ]}
      />
      <Backups
        token={token}
        status={backups.data}
        error={backups.error?.message}
        health={health.data?.backup}
      />
      <Exports token={token} list={exports.data?.exports} error={exports.error?.message} />
    </>
  );
};

const Backups = ({
  token,
  status,
  error,
  health,
}: {
  token: string;
  status: BackupStatus | undefined;
  error: string | undefined;
  health: ServiceStatus["backup"];
}) => {
  const backUp = useManagementCall(
    token,
    "fleet",
    "management",
    (manifest: BackupManifest) => `backup ${manifest.file} taken ${iso(manifest.taken_at_ms)}`,
  );
  const last = status?.last_success;
  const failed = status?.last_failure;
  const drill = status?.last_drill;
  return (
    <>
      <h2 className="m-0 mb-2 text-sm font-semibold">Backups</h2>
      <Card className="mb-4 overflow-x-auto">
        {!status ? (
          <p className="m-0 px-3.5 py-2 text-xs text-muted">{error ?? "Loading"}</p>
        ) : (
          <table aria-label="Backups" className="w-full border-collapse text-xs">
            <tbody>
              <tr>
                <th className={th}>Last backup</th>
                <td className={`${td} ${BACKUP_TONE[health?.state ?? ""] ?? ""}`}>
                  {last ? `${iso(last.taken_at_ms)}, ${size(last.size_bytes)}` : "none"}
                  {/* Age and state as the server grades them against its threshold. */}
                  {health
                    ? `, ${health.age_seconds === undefined ? "" : `${age(0, health.age_seconds * 1_000)} old, `}${health.state}`
                    : ""}
                </td>
              </tr>
              {failed && (!last || failed.at_ms > last.taken_at_ms) && (
                <tr>
                  <th className={th}>Last attempt</th>
                  <td className={`${td} text-danger`}>
                    {iso(failed.at_ms)}: {failed.error}
                  </td>
                </tr>
              )}
              <tr className="[&>*]:border-b-0">
                <th className={th}>Restore drill</th>
                <td className={`${td} ${drill ? "" : "text-muted"}`}>
                  {drill
                    ? `${iso(drill.restored_at_ms)}, ${drill.file}, integrity ${drill.integrity}, ${drill.environments} environments, ${drill.releases} releases, ${drill.plans} plans`
                    : "none recorded"}
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </Card>
      {(backUp.allowed || backUp.outcome) && (
        <div className="-mt-2 mb-4 flex flex-wrap items-center gap-2">
          {backUp.allowed && (
            <ConfirmButton
              label="Back up now"
              confirm="Take a backup now"
              disabled={backUp.isPending}
              onConfirm={() => backUp.mutate({ path: "v1/backups" })}
            />
          )}
          {/* Shown even once a refusal has hidden the button. */}
          {backUp.outcome && <Notice tone={backUp.outcome.tone}>{backUp.outcome.text}</Notice>}
        </div>
      )}
    </>
  );
};

const Exports = ({
  token,
  list,
  error,
}: {
  token: string;
  list: ExportEntry[] | undefined;
  error: string | undefined;
}) => {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [fields, setFields] = useState<ExportFields>({
    environment: "",
    plan_id: "",
    upgrade: "",
  });
  const [downloaded, setDownloaded] = useState<Outcome>();
  const create = useManagementCall(
    token,
    "fleet",
    "management",
    (entry: ExportEntry) => `${entry.file_name} created`,
  );
  const fetchFile = async (id: string, fileName: string) => {
    setDownloaded(undefined);
    try {
      await download(
        `v1/exports/${encodeURIComponent(id)}/download?reason=${encodeURIComponent(reason.trim())}`,
        token,
        fileName,
      );
      setDownloaded({ tone: "ok", text: `${fileName} downloaded` });
    } catch (caught) {
      setDownloaded(failure(caught, "management"));
    } finally {
      void queryClient.invalidateQueries({ queryKey: ["exports"] });
    }
  };
  const set = (key: keyof ExportFields) => (value: string) =>
    setFields((current) => ({ ...current, [key]: value }));
  const rows = historyRows(list ?? []);
  return (
    <>
      <h2 className="m-0 mb-2 text-sm font-semibold">Exports</h2>
      <div className="mb-2 flex flex-wrap gap-2">
        <input
          aria-label="Reason"
          placeholder="Reason (recorded with every create and download)"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className={`${field} min-w-72 flex-1`}
        />
        <input
          aria-label="Environment"
          placeholder="Environment"
          value={fields.environment}
          onChange={(event) => set("environment")(event.target.value)}
          className={field}
        />
        <input
          aria-label="Plan"
          placeholder="Plan id"
          value={fields.plan_id}
          onChange={(event) => set("plan_id")(event.target.value)}
          className={field}
        />
        <input
          aria-label="Upgrade"
          placeholder="Upgrade"
          value={fields.upgrade}
          onChange={(event) => set("upgrade")(event.target.value)}
          className={field}
        />
      </div>
      <Card className="mb-2 overflow-x-auto">
        <table aria-label="Export kinds" className="w-full border-collapse text-xs">
          <tbody>
            {EXPORT_KINDS.map(({ kind, label }) => (
              <KindRow
                key={kind}
                kind={kind}
                label={label}
                body={exportRequest(kind, reason, fields)}
                allowed={create.allowed}
                pending={create.isPending}
                onCreate={(body) => create.mutate({ path: "v1/exports", body })}
              />
            ))}
          </tbody>
        </table>
      </Card>
      {create.outcome && (
        <div className="mb-2">
          <Notice tone={create.outcome.tone}>{create.outcome.text}</Notice>
        </div>
      )}
      <h2 className="mt-4 mb-2 text-sm font-semibold">Export history</h2>
      <Card className="overflow-x-auto">
        <table aria-label="Export history" className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className={th}>When</th>
              <th className={th}>Who</th>
              <th className={th}>What</th>
              <th className={th}>Reason</th>
              <th className={th}>Size</th>
              <th className={th}>Downloads</th>
              <th className={th} aria-label="Download" />
            </tr>
          </thead>
          <tbody>
            {list === undefined ? (
              <tr>
                <td className={`${td} border-b-0 text-muted`} colSpan={7}>
                  {error ?? "Loading"}
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td className={`${td} border-b-0 text-muted`} colSpan={7}>
                  No exports yet
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="[&:last-child>td]:border-b-0">
                  <td className={td}>{iso(row.createdAt)}</td>
                  <td className={td}>{row.createdBy}</td>
                  <td className={td} title={row.id}>
                    {row.kind}
                    {row.environment ? ` ${row.environment}` : ""}{" "}
                    <span className="font-mono text-muted">{row.fileName}</span>
                  </td>
                  <td className={`${td} text-muted`}>{row.reason}</td>
                  <td className={td}>{size(row.sizeBytes)}</td>
                  <td className={td}>{row.downloads}</td>
                  <td className={td}>
                    <Button
                      disabled={!reason.trim()}
                      title={reason.trim() ? undefined : "Enter a reason first"}
                      onClick={() => void fetchFile(row.id, row.fileName)}
                    >
                      Download
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
      {downloaded && (
        <div className="mt-2">
          <Notice tone={downloaded.tone}>{downloaded.text}</Notice>
        </div>
      )}
    </>
  );
};

/** One export kind: what it still needs, or a confirmed Create. */
const KindRow = ({
  kind,
  label,
  body,
  allowed,
  pending,
  onCreate,
}: {
  kind: ExportKind;
  label: string;
  body: ReturnType<typeof exportRequest>;
  allowed: boolean;
  pending: boolean;
  onCreate: (body: Exclude<ReturnType<typeof exportRequest>, string>) => void;
}) => (
  <tr className="[&:last-child>td]:border-b-0">
    <td className={td}>{label}</td>
    <td className={`${td} text-muted`}>{typeof body === "string" ? body : ""}</td>
    <td className={`${td} text-right`}>
      {allowed && (
        <ConfirmButton
          label="Create"
          confirm={`Create ${kind}`}
          disabled={pending || typeof body === "string"}
          onConfirm={() => {
            if (typeof body !== "string") {
              onCreate(body);
            }
          }}
        />
      )}
    </td>
  </tr>
);
