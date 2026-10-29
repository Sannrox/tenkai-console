import type {
  ContentInventory,
  EntryProgress,
  ImportJob,
  ImportRequest,
  StagedBundle,
} from "../api/tenkai.gen";
import { size } from "./operations";

/**
 * The Imports screen (#35) over server-side bundle import and content
 * inventory (`/v1/imports`, `/v1/content/inventory`, Sannrox/tenkai#680).
 * The columns follow the host's job list (`GET /v1/imports`,
 * Sannrox/tenkai#821), so they survive a reload; a running job carries
 * per-entry progress. The list is per host: each server lists the imports
 * it ran. Free space and chunk-level inventory are not offered yet
 * (Sannrox/tenkai#827).
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
 * Whether a finished job was about this staged archive, not an earlier file
 * of the same name. Tenkai reports no archive digest on the staging list and
 * no size or staging time on a job, so the identity both carry is the file,
 * the environment and the plan (the job's from its verified preview). A job
 * without a preview, or a staged file without a plan, is never matched, so
 * an unproven bundle stays staged. A re-export for the same plan under the
 * same name is not told apart.
 */
const sameBundle = (bundle: StagedBundle, job: ImportJob): boolean =>
  job.bundle === bundle.file &&
  job.environment === bundle.environment &&
  bundle.plan_id !== undefined &&
  job.preview?.plan_id === bundle.plan_id;

/**
 * The upgrade a bundle's input shows: what was entered for it, else the
 * upgrade of its newest passing dry run, so a checked bundle stays checked
 * after a reload.
 */
export const upgradeFor = (
  bundle: StagedBundle,
  jobs: ImportJob[],
  upgrades: Readonly<Record<string, string>>,
): string =>
  upgrades[bundle.file] ??
  newest(jobs.filter((job) => job.dry_run && job.state === "previewed" && sameBundle(bundle, job)))
    ?.upgrade ??
  "";

const newest = (jobs: ImportJob[]) => jobs.toSorted((a, b) => b.started_at_ms - a.started_at_ms)[0];

/**
 * Each staged bundle in its column: imported after a real import of it
 * succeeded, checked while a passing dry run of it matches exactly its
 * upgrade (`upgradeFor`), staged otherwise (`sameBundle` says which jobs
 * were of it). A changed upgrade needs a new dry run. A failed job leaves
 * the bundle where it was, with the refusal shown under it.
 */
export const bundleCards = (
  staged: StagedBundle[],
  jobs: ImportJob[],
  upgrades: Readonly<Record<string, string>>,
): BundleCard[] =>
  staged.map((bundle) => {
    const latest = newest(jobs.filter((job) => job.bundle === bundle.file));
    const own = jobs.filter((job) => sameBundle(bundle, job));
    const upgrade = upgradeFor(bundle, jobs, upgrades).trim();
    const column: Column = own.some((job) => !job.dry_run && job.state === "succeeded")
      ? "imported"
      : own.some((job) => job.dry_run && job.state === "previewed" && job.upgrade === upgrade)
        ? "checked"
        : "staged";
    return { bundle, column, job: latest };
  });

/** Whether any job still runs, so the list is polled. */
export const anyRunning = (jobs: ImportJob[] | undefined): boolean =>
  jobs?.some((job) => job.state === "running") ?? false;

/**
 * Whether a job running in `before` no longer runs in `after`, so what the
 * host holds may have changed. Each job counts on its own, so one import
 * finishing while another still runs is caught.
 */
export const finishedSince = (before: ImportJob[] | undefined, after: ImportJob[]): boolean => {
  const running = new Set(after.filter((job) => job.state === "running").map((job) => job.id));
  return (before ?? []).some((job) => job.state === "running" && !running.has(job.id));
};

/** `digest kind done / total (pct%)` of one entry. */
export const progressLine = (entry: EntryProgress): string => {
  const percent =
    entry.bytes_total === 0 ? 100 : Math.floor((entry.bytes_done / entry.bytes_total) * 100);
  return `${entry.kind} ${entry.digest} ${size(entry.bytes_done)} / ${size(entry.bytes_total)} (${percent}%)`;
};

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
