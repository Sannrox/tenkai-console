import type { CertificateEntry, RuntimeRunner, TrustPosture } from "../api/tenkai.gen";

/**
 * Transport and runner identity posture for the Server screen (#39), read
 * from the trust posture (GET `/v1/trust`, Sannrox/tenkai#676) and the runner
 * registry (GET `/v1/runners`, Sannrox/tenkai#673). Every fact is one the
 * server reports. Tenkai does not report whether runner client certificates
 * are required, the runner CA fingerprint, or how an enrolled runner
 * authenticates, so none of those is shown or guessed.
 */

export type HubTransport = {
  /**
   * `native` when the server loaded a listener certificate. Without one it
   * binds plaintext on loopback only, so it is reached through a proxy or
   * from the same host.
   */
  tls: "native" | "proxy or local";
  /**
   * Every certificate of each kind, worst status first: a source may hold
   * several, such as a listener chain or an old and a new CA mid-rotation.
   */
  listener: CertificateEntry[];
  /** Client CAs verify runner certificates when presented. */
  clientCa: CertificateEntry[];
  runnerCa: CertificateEntry[];
};

const SEVERITY: Record<CertificateEntry["status"], number> = {
  expired: 0,
  critical: 1,
  warning: 2,
  ok: 3,
};

// Purposes Tenkai gives the certificates it loaded (crates/tenkai-server trust_sources).
const entries = (posture: TrustPosture, purpose: string) =>
  posture.tls
    .filter((certificate) => certificate.purpose === purpose)
    .toSorted((a, b) => SEVERITY[a.status] - SEVERITY[b.status]);

export const hubTransport = (posture: TrustPosture): HubTransport => {
  const listener = entries(posture, "listener");
  return {
    tls: listener.length > 0 ? "native" : "proxy or local",
    listener,
    clientCa: entries(posture, "tls_client_ca"),
    runnerCa: entries(posture, "runner_ca"),
  };
};

/** `CN=runner-ca, until 2026-12-01 (34 days)`, or the server's error. */
export const describeCertificate = (certificate: CertificateEntry): string => {
  if (certificate.error) {
    return certificate.error;
  }
  const until =
    certificate.not_after === undefined
      ? undefined
      : `until ${new Date(certificate.not_after * 1_000).toISOString().slice(0, 10)}${
          certificate.days_left === undefined ? "" : ` (${certificate.days_left} days)`
        }`;
  return [certificate.subject, until].filter(Boolean).join(", ") || certificate.file;
};

export type EnvironmentAuthRow = {
  environment: string;
  /** Runners that can act: enrolled and active, or static. */
  runners: number;
  /** Static runtime tokens from server configuration: bearer by definition. */
  bearer: number;
};

/** One row per environment the server names or a runner belongs to, sorted. */
export const environmentAuth = (
  runners: RuntimeRunner[],
  environments: string[],
): EnvironmentAuthRow[] =>
  [...new Set([...environments, ...runners.map((runner) => runner.environment)])]
    .toSorted((a, b) => a.localeCompare(b))
    .map((environment) => {
      const live = runners.filter(
        (runner) => runner.environment === environment && runner.state !== "revoked",
      );
      return {
        environment,
        runners: live.length,
        bearer: live.filter((runner) => runner.state === "static").length,
      };
    });
