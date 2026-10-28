import type { ContentInventory, ImportJob, ImportRequest, StagedBundle } from "../api/tenkai.gen";

/**
 * The Imports screen (#35) over server-side bundle import and content
 * inventory (`/v1/imports`, `/v1/content/inventory`, Sannrox/tenkai#680).
 * Tenkai lists staged archives and answers each import request with a job;
 * it has no list of past jobs, no per-entry progress, no free space and no
 * chunk-level inventory, so the columns place only bundles checked or
 * imported from this page, and none of the rest is shown.
 */

/** `POST /v1/imports`, as `tenkaictl upgrade bind-bundle` binds. */
export const importBody = (
  bundle: string,
  environment: string,
  upgrade: string,
  dryRun: boolean,
): ImportRequest => ({
  version: 1,
  operation: "import",
  bundle,
  environment,
  upgrade: upgrade.trim(),
  dry_run: dryRun,
});

export type Column = "staged" | "checked" | "imported";

export type BundleCard = {
  bundle: StagedBundle;
  column: Column;
  /** The latest job for this bundle from this page, if any. */
  job: ImportJob | undefined;
};

/**
 * Each staged bundle in its column: imported after a real import succeeded,
 * checked while a passing dry run matches exactly the upgrade now entered
 * for it (`upgrades`, by file) and its environment, staged otherwise. A
 * changed upgrade needs a new dry run. A failed job leaves the bundle where
 * it was, with the refusal shown under it.
 */
export const bundleCards = (
  staged: StagedBundle[],
  jobs: ImportJob[],
  upgrades: Readonly<Record<string, string>>,
): BundleCard[] =>
  staged.map((bundle) => {
    const own = jobs.filter((job) => job.bundle === bundle.file);
    const latest = own.toSorted((a, b) => b.started_at_ms - a.started_at_ms)[0];
    const upgrade = (upgrades[bundle.file] ?? "").trim();
    const column: Column = own.some((job) => !job.dry_run && job.state === "succeeded")
      ? "imported"
      : own.some(
            (job) =>
              job.dry_run &&
              job.state === "previewed" &&
              job.upgrade === upgrade &&
              job.environment === bundle.environment,
          )
        ? "checked"
        : "staged";
    return { bundle, column, job: latest };
  });

export type ContentRow = {
  release: string;
  kind: string;
  digest: string;
  sizeBytes: number | undefined;
  /** `true` held, `false` missing, `undefined` when no store is configured. */
  stored: boolean | undefined;
  usedBy: string[];
};

/** One row per layer or weight of each release, with what references the release. */
export const contentRows = (inventory: ContentInventory): ContentRow[] =>
  inventory.releases.flatMap((release) =>
    release.content.map((item) => ({
      release: `${release.product} ${release.version}`,
      kind: item.kind,
      digest: item.digest,
      sizeBytes: item.size_bytes,
      stored: item.stored,
      usedBy: release.referenced_by,
    })),
  );
