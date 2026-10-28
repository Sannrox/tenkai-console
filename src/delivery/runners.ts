import type { RuntimeEnrollmentIssued, RuntimeRunner } from "../api/tenkai.gen";

/**
 * Runner fleet rows (GET `/v1/runners`, Sannrox/tenkai#673) and the runtime
 * environment an enrollment token is used with (Sannrox/tenkai#630). Labels
 * and ordering only; every value is the server's. The registry reports no
 * certificate expiry yet, so the table has no column for it.
 */

export type RunnerRow = {
  id: string;
  environment: string;
  state: string;
  /** Newest plan pull of any instance, as an age. */
  lastPull: string;
  heartbeat: string;
  version: string;
  lease: string;
  /** Only an enrolled, active credential can be revoked; static tokens change in server config. */
  revocable: boolean;
};

/** A compact age: `<1m`, `5m`, `3h`, `2d`; `none` without a time. */
export const age = (at: number | undefined, now: number): string => {
  if (at === undefined) {
    return "none";
  }
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) {
    return "<1m";
  }
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
};

const newest = (times: Array<number | undefined>): number | undefined =>
  times.reduce<number | undefined>(
    (best, at) => (at !== undefined && (best === undefined || at > best) ? at : best),
    undefined,
  );

/** The version of the most recent instance, with its skew when not current. */
const version = (runner: RuntimeRunner): string => {
  const instance = runner.instances[0];
  if (!instance?.runtime_version) {
    return "none";
  }
  return instance.skew && instance.skew !== "current"
    ? `${instance.runtime_version} ${instance.skew}`
    : instance.runtime_version;
};

/** Rows for `environment` (all when empty), by environment then id. */
export const runnerRows = (runners: RuntimeRunner[], environment: string, now: number) =>
  runners
    .filter((runner) => !environment || runner.environment === environment)
    .toSorted((a, b) => a.environment.localeCompare(b.environment) || a.id.localeCompare(b.id))
    .map((runner): RunnerRow => ({
      id: runner.id,
      environment: runner.environment,
      state: runner.state,
      lastPull: age(newest(runner.instances.map((instance) => instance.last_work_at)), now),
      heartbeat: age(newest(runner.instances.map((instance) => instance.last_heartbeat_at)), now),
      version: version(runner),
      lease: runner.instances.some((instance) => instance.holds_lease) ? "held" : "none",
      revocable: runner.state === "active",
    }));

/** Environments to filter by: every environment named by the server, once, sorted. */
export const filterEnvironments = (runners: RuntimeRunner[], environments: string[]): string[] =>
  [...new Set([...environments, ...runners.map((runner) => runner.environment)])].toSorted((a, b) =>
    a.localeCompare(b),
  );

/** `sha256:` ids are long; the first 12 hex digits name a runner in confirmations. */
export const shortId = (id: string): string =>
  id.startsWith("sha256:") ? id.slice(0, "sha256:".length + 12) : id;

/**
 * What to set on the runtime host for a first start, as in Tenkai's
 * "Enrolling a runtime": the server URL, the environment, where the
 * credential is kept, and the single-use token.
 */
export const runtimeEnvironment = (issued: RuntimeEnrollmentIssued, serverUrl: string): string =>
  [
    `TENKAI_SERVER_URL=${serverUrl}`,
    `TENKAI_RUNTIME_ENVIRONMENT=${issued.environment}`,
    "TENKAI_RUNTIME_CREDENTIAL_FILE=/var/lib/tenkai-runtime/credential",
    `TENKAI_RUNTIME_ENROLLMENT_TOKEN=${issued.token}`,
  ].join("\n");
