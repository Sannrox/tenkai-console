import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { request } from "../api/http";
import type { ContentInventory, ImportJob, StagedBundle } from "../api/tenkai.gen";
import { useSession } from "../auth/session";
import {
  bundleCards,
  contentRows,
  importBody,
  type BundleCard,
  type Column,
} from "../delivery/imports";
import { size } from "../delivery/operations";
import { useManagementCall } from "../management/use-management";
import { Button, Card, ConfirmButton, Notice } from "../ui/kit";
import { RefreshFailed, td, th } from "../ui/posture";

const field =
  "min-w-0 rounded-md border border-field bg-white/4 px-2 py-1 text-xs text-fg placeholder:text-muted";

const COLUMNS: Array<{ column: Column; title: string }> = [
  { column: "staged", title: "Staged" },
  { column: "checked", title: "Checked (dry run passed)" },
  { column: "imported", title: "Imported" },
];

/** Re-read a running job this often; it stops once the job finishes. */
const JOB_POLL_MS = 1_000;

/**
 * The 2026-10-28 pick B (#35): staged, checked and imported columns that a
 * bundle moves across, then the content inventory. A top-level tab (#34).
 * Bundles are staged on the host, never uploaded from the browser.
 */
export const Imports = () => {
  const token = useSession((state) => state.session?.accessToken);
  const queryClient = useQueryClient();
  const staged = useQuery({
    queryKey: ["imports-staged", token],
    queryFn: () => request<StagedBundle[]>("v1/imports/staged", { token }),
    enabled: token !== undefined,
    retry: false,
  });
  const inventory = useQuery({
    queryKey: ["content-inventory", token],
    queryFn: () => request<ContentInventory>("v1/content/inventory", { token }),
    enabled: token !== undefined,
    retry: false,
  });
  // Jobs started from this page; Tenkai offers no list of earlier ones.
  const [jobIds, setJobIds] = useState<string[]>([]);
  // The upgrade entered per bundle file; a checked bundle is checked for this one.
  const [upgrades, setUpgrades] = useState<Record<string, string>>({});
  const jobs = useQueries({
    queries: jobIds.map((id) => ({
      queryKey: ["import-job", id, token],
      queryFn: async () => {
        const job = await request<ImportJob>(`v1/imports/${encodeURIComponent(id)}`, { token });
        // A finished job may have changed what the host holds.
        if (job.state !== "running") {
          void queryClient.invalidateQueries({ queryKey: ["content-inventory"] });
        }
        return job;
      },
      retry: false,
      refetchInterval: (query: { state: { data: ImportJob | undefined } }) =>
        query.state.data?.state === "running" ? JOB_POLL_MS : false,
    })),
  });
  const known = jobs.flatMap((job) => (job.data ? [job.data] : []));
  if (token === undefined) {
    return null;
  }
  const started = (job: ImportJob) => {
    queryClient.setQueryData(["import-job", job.id, token], job);
    setJobIds((ids) => (ids.includes(job.id) ? ids : [...ids, job.id]));
    void queryClient.invalidateQueries({ queryKey: ["content-inventory"] });
  };
  const cards = staged.data ? bundleCards(staged.data, known, upgrades) : [];
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="m-0 text-lg font-semibold">Imports</h1>
        <Button
          variant="ghost"
          className="ml-auto"
          onClick={() => void Promise.all([staged.refetch(), inventory.refetch()])}
        >
          Refresh
        </Button>
      </div>
      <RefreshFailed
        queries={[
          ["staged", staged],
          ["inventory", inventory],
        ]}
      />
      {!staged.data ? (
        <p aria-label="Staged bundles" className="m-0 mb-4 text-xs text-muted">
          {staged.error?.message ?? "Loading"}
        </p>
      ) : (
        <div className="mb-6 grid gap-3 md:grid-cols-3">
          {COLUMNS.map(({ column, title }) => (
            <section key={column} aria-label={title}>
              <h2 className="m-0 mb-2 text-sm font-semibold">{title}</h2>
              {cards
                .filter((card) => card.column === column)
                .map((card) => (
                  <Bundle
                    key={card.bundle.file}
                    card={card}
                    token={token}
                    upgrade={upgrades[card.bundle.file] ?? ""}
                    setUpgrade={(value) =>
                      setUpgrades((current) => ({ ...current, [card.bundle.file]: value }))
                    }
                    onStarted={started}
                  />
                ))}
            </section>
          ))}
        </div>
      )}
      <Inventory inventory={inventory.data} error={inventory.error?.message} />
    </>
  );
};

/** One staged archive: what it targets, its last job, and the next step. */
const Bundle = ({
  card,
  token,
  upgrade,
  setUpgrade,
  onStarted,
}: {
  card: BundleCard;
  token: string;
  upgrade: string;
  setUpgrade: (value: string) => void;
  onStarted: (job: ImportJob) => void;
}) => {
  const { bundle, job, column } = card;
  const environment = bundle.environment ?? "";
  const call = useManagementCall(
    token,
    `environment:${environment}`,
    "management",
    (result: ImportJob) => `${result.dry_run ? "dry run" : "import"} ${result.state}`,
  );
  const run = (dryRun: boolean) =>
    call.mutate(
      { path: "v1/imports", body: importBody(bundle.file, environment, upgrade, dryRun) },
      { onSuccess: onStarted },
    );
  const ready =
    !call.isPending && environment !== "" && upgrade.trim() !== "" && job?.state !== "running";
  return (
    <Card className="mb-2 px-3 py-2 text-xs">
      <div className="font-mono break-all">{bundle.file}</div>
      <div className="text-muted">
        {[
          environment || "environment unknown",
          bundle.plan_id,
          size(bundle.size_bytes),
          bundle.chunked ? "chunked" : undefined,
          bundle.expires_at_ms === undefined
            ? undefined
            : `expires ${new Date(bundle.expires_at_ms).toISOString()}`,
        ]
          .filter(Boolean)
          .join(" · ")}
      </div>
      {bundle.unreadable && <div className="text-danger">{bundle.unreadable}</div>}
      {job && (
        <div className={job.state === "failed" ? "text-danger" : "text-muted"}>
          {job.dry_run ? "dry run" : "import"} {job.state}
          {job.refusal ? `: ${job.refusal}` : ""}
          {job.preview ? ` · bundle ${job.preview.bundle_digest}` : ""}
        </div>
      )}
      {call.outcome?.tone !== "ok" && call.outcome && (
        <Notice tone={call.outcome.tone}>{call.outcome.text}</Notice>
      )}
      {call.allowed && column !== "imported" && !bundle.unreadable && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <input
            aria-label={`Upgrade for ${bundle.file}`}
            placeholder="Upgrade"
            value={upgrade}
            onChange={(event) => setUpgrade(event.target.value)}
            className={field}
          />
          {column === "staged" ? (
            <Button disabled={!ready} onClick={() => run(true)}>
              Dry run
            </Button>
          ) : (
            <ConfirmButton
              label="Import"
              confirm={`Import into ${environment}`}
              disabled={!ready}
              onConfirm={() => run(false)}
            />
          )}
        </div>
      )}
    </Card>
  );
};

const STORED = (stored: boolean | undefined) =>
  stored === undefined ? "no store" : stored ? "held" : "missing";

/** Space used and every layer and weight per release, with what uses it. */
const Inventory = ({
  inventory,
  error,
}: {
  inventory: ContentInventory | undefined;
  error: string | undefined;
}) => {
  if (!inventory) {
    return (
      <p aria-label="Content inventory" className="m-0 text-xs text-muted">
        Content: {error ?? "Loading"}
      </p>
    );
  }
  const rows = contentRows(inventory);
  const used = [
    inventory.oci_store_bytes === undefined
      ? "OCI store not configured"
      : `OCI store ${size(inventory.oci_store_bytes)}`,
    inventory.weight_cache_bytes === undefined
      ? "weight cache not configured"
      : `weight cache ${size(inventory.weight_cache_bytes)}`,
  ];
  return (
    <>
      <h2 className="m-0 mb-1 text-sm font-semibold">Content</h2>
      <p aria-label="Space used" className="m-0 mb-2 text-xs text-muted">
        Used: {used.join(", ")}
      </p>
      <Card className="overflow-x-auto">
        <table aria-label="Content inventory" className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className={th}>Release</th>
              <th className={th}>Kind</th>
              <th className={th}>Digest</th>
              <th className={th}>Size</th>
              <th className={th}>Here</th>
              <th className={th}>Used by</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className={`${td} border-b-0 text-muted`} colSpan={6}>
                  No release content
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={`${row.release}|${row.digest}`} className="[&:last-child>td]:border-b-0">
                  <td className={td}>{row.release}</td>
                  <td className={td}>{row.kind}</td>
                  <td className={`${td} font-mono break-all`}>{row.digest}</td>
                  <td className={td}>{row.sizeBytes === undefined ? "" : size(row.sizeBytes)}</td>
                  <td className={`${td} ${row.stored === false ? "text-danger" : "text-muted"}`}>
                    {STORED(row.stored)}
                  </td>
                  <td className={`${td} text-muted`}>{row.usedBy.join(", ") || "nothing"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
      {inventory.missing.length > 0 && (
        <p aria-label="Missing content" className="mt-2 mb-0 text-xs text-danger">
          Missing here: {inventory.missing.join(", ")}
        </p>
      )}
    </>
  );
};
