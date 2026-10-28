import type {
  CertificateEntry,
  RuntimeRunner,
  SigningRoot,
  TrustPosture,
  TrustSource,
} from "../api/tenkai.gen";

/**
 * Transport and runner identity posture for the Server screen (#39), read
 * from the trust posture (GET `/v1/trust`, Sannrox/tenkai#676) and the runner
 * registry (GET `/v1/runners`, Sannrox/tenkai#673), with the client
 * certificate requirement, fingerprints and per-runner auth of
 * Sannrox/tenkai#809. Every fact is one the server reports; a server older
 * than #809 omits them, and they read as unknown rather than guessed.
 */

export type HubTransport = {
  /**
   * `native` when the server loaded a listener certificate. Without one it
   * binds plaintext on loopback only, so it is reached through a proxy or
   * from the same host.
   */
  tls: "native" | "proxy or local";
  /** Whether runtime routes refuse a connection without a client certificate. */
  mtls: "required" | "optional" | "unknown";
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
    // A server before Sannrox/tenkai#809 omits the field despite the contract type.
    mtls: !("runtime_client_cert_required" in posture)
      ? "unknown"
      : posture.runtime_client_cert_required
        ? "required"
        : "optional",
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
  /** Runners the runner CA issued a client certificate. */
  mtls: number;
  bearer: number;
  /** Runners an older server reported no `auth` for. */
  unknown: number;
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
        mtls: live.filter((runner) => runner.auth === "client_certificate").length,
        bearer: live.filter((runner) => runner.auth === "bearer").length,
        unknown: live.filter((runner) => runner.auth === undefined).length,
      };
    });

/**
 * TLS certificates soonest expiry first, for the Trust tab (#36). One with
 * no expiry (unreadable, so `critical`) sorts first: it cannot be relied on now.
 */
export const byExpiry = (certificates: CertificateEntry[]): CertificateEntry[] =>
  certificates.toSorted(
    (a, b) =>
      (a.not_after ?? Number.NEGATIVE_INFINITY) - (b.not_after ?? Number.NEGATIVE_INFINITY) ||
      a.purpose.localeCompare(b.purpose),
  );

/**
 * The first TLS certificate to lapse, for the runway banner, unless every
 * certificate is `ok`. Tenkai checks a plan against certificate expiry when
 * the plan is created (Sannrox/tenkai#778) but reports that only in the
 * plan's creation message, so the banner cannot name a scheduled plan.
 */
export const firstExpiry = (posture: TrustPosture): CertificateEntry | undefined =>
  byExpiry(posture.tls).find((certificate) => certificate.status !== "ok");

export type SignerRow = {
  purpose: string;
  file: string;
  identity: string;
  keyId: string;
  /** Where the server read this signer: what it verifies with, the file on disk, or both. */
  sources: TrustSource[];
  /** `trusted`, `revoked`, `no signers`, or the error of an unreadable root. */
  state: string;
  tone: "bad" | "warning" | "ok";
};

/**
 * One row per signer of each trust root; an unreadable root, or one with
 * no signers, as one row of its own. A key listed by more than one source of a purpose is one row.
 * Signers carry no expiry, so rows sort by purpose and identity.
 */
export const signerRows = (roots: SigningRoot[]): SignerRow[] => {
  type Seen = Pick<SignerRow, "purpose" | "file" | "identity" | "keyId" | "sources"> & {
    revoked: boolean;
  };
  const seen = new Map<string, Seen>();
  // An unreadable root, or one that trusts nobody, is a row of its own.
  const rootRows: SignerRow[] = [];
  for (const root of roots) {
    if (root.error || root.signers.length === 0) {
      rootRows.push({
        purpose: root.purpose,
        file: root.file,
        identity: "",
        keyId: "",
        sources: [root.source],
        state: root.error ?? "no signers",
        tone: root.error ? "bad" : "warning",
      });
      continue;
    }
    for (const signer of root.signers) {
      const key = `${root.purpose}|${signer.key_id}`;
      const entry = seen.get(key) ?? {
        purpose: root.purpose,
        file: root.file,
        identity: signer.identity,
        keyId: signer.key_id,
        sources: [],
        revoked: false,
      };
      if (!entry.sources.includes(root.source)) {
        entry.sources.push(root.source);
      }
      entry.revoked ||= signer.revoked;
      seen.set(key, entry);
    }
  }
  const signers = [...seen.values()].map((entry): SignerRow => ({
    purpose: entry.purpose,
    file: entry.file,
    identity: entry.identity,
    keyId: entry.keyId,
    sources: entry.sources,
    state: entry.revoked ? "revoked" : "trusted",
    tone: entry.revoked ? "bad" : "ok",
  }));
  return [...rootRows, ...signers].toSorted(
    (a, b) => a.purpose.localeCompare(b.purpose) || a.identity.localeCompare(b.identity),
  );
};

/**
 * Trust roots shown as their file is on disk now (`source: "file"`). The
 * server loaded them at start, so a changed file takes effect only after a
 * restart; a root reported as `loaded` is what the server uses and needs no note.
 */
export const onDiskRoots = (roots: SigningRoot[]): SigningRoot[] =>
  roots.filter((root) => root.source === "file");
