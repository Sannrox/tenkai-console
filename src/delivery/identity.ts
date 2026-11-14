import type { HealthCheck, HealthTone } from "./instances";

// `GET /v1/environments/{environment}/status` `StatusRow.certificate`
// (Tenkai #1072 / #1167). The pinned contract predates the field, so the
// GET is validated in `identity-status.ts` rather than trusted as a
// generated type.
//
// Reuse decision
// Job: show each instance's workload identity expiry and near-expiry on the
// instance list, with no actions.
// Verdict: Reuse
// Concept: extra status fields as in `drift.ts`; arktype GET as in
// `history.ts`; environment-detail table as overlays.
// Edge: omitted certificate is no identity; 404/405 is an older server;
// near_expiry and expires_at come from the server; URI is
// tenkai://env/instance only when a certificate was reported; pin stays.
// DNS names, certificate kind, reload, issuer generation, restart
// rollout, min_available, and runtime audit history are not on
// CertificateStatus.
// Searched: StatusRow.certificate, CertificateStatus, inspect
// subscriptions, identity_issuer, history attempts. Rejected: pin bump;
// inventing grant fields; a countdown.

export type CertificateStatus = {
  expires_at: number;
  near_expiry: boolean;
  renewal_failure?: string;
};

/** Status fields the console reads: identity, and live health with its checks (Tenkai #1057). */
export type StatusRow = {
  product: string;
  instance?: string;
  certificate?: CertificateStatus | null;
  health?: string | null;
  error?: string | null;
  health_checks?: HealthCheck[];
};

export type StatusLoad =
  | { kind: "ok"; value: StatusRow[] }
  | { kind: "unavailable" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string };

export type IdentityState = "none" | "valid" | "renewing" | "near expiry" | "expired";

export type IdentityView = {
  instance: string;
  identity: string;
  state: IdentityState;
  expires: string;
  failure: string;
  tone: HealthTone;
};

const STATE_TONE: Record<IdentityState, HealthTone> = {
  none: "muted",
  valid: "ok",
  renewing: "warn",
  "near expiry": "warn",
  expired: "bad",
};

/** Instance this status row names. Equals the product when unnamed. */
export const statusInstance = (row: StatusRow): string => {
  const instance = row.instance?.trim() ?? "";
  return instance === "" ? row.product : instance;
};

export const identityState = (
  certificate: CertificateStatus | null | undefined,
  nowSecs: number,
): IdentityState => {
  if (certificate === null || certificate === undefined) {
    return "none";
  }
  if (certificate.expires_at <= nowSecs) {
    return "expired";
  }
  if (certificate.near_expiry) {
    return "near expiry";
  }
  if ((certificate.renewal_failure ?? "").trim() !== "") {
    return "renewing";
  }
  return "valid";
};

const expiryLabel = (expiresAt: number): string => new Date(expiresAt * 1000).toISOString();

/** One instance's identity as status reported it. */
export const identityView = (
  environment: string,
  instance: string,
  certificate: CertificateStatus | null | undefined,
  nowSecs: number,
): IdentityView => {
  const state = identityState(certificate, nowSecs);
  const failure = certificate?.renewal_failure?.trim() ?? "";
  return {
    instance,
    identity: state === "none" ? "none" : `tenkai://${environment}/${instance}`,
    state,
    expires:
      certificate === null || certificate === undefined
        ? "none"
        : expiryLabel(certificate.expires_at),
    failure: failure === "" ? "none" : failure,
    tone: STATE_TONE[state],
  };
};

export const certificatesByInstance = (
  rows: StatusRow[],
): ReadonlyMap<string, CertificateStatus> => {
  const out = new Map<string, CertificateStatus>();
  for (const row of rows) {
    if (row.certificate === null || row.certificate === undefined) {
      continue;
    }
    out.set(statusInstance(row), row.certificate);
  }
  return out;
};

/** Identity for each named instance, plus any status row the list omitted. */
export const identityRows = (
  environment: string,
  instances: readonly string[],
  rows: StatusRow[],
  nowSecs: number,
): IdentityView[] => {
  const certificates = certificatesByInstance(rows);
  const seen = new Set<string>();
  const views: IdentityView[] = [];
  for (const instance of instances) {
    const name = instance.trim();
    if (name === "" || seen.has(name)) {
      continue;
    }
    seen.add(name);
    views.push(identityView(environment, name, certificates.get(name), nowSecs));
  }
  for (const row of rows) {
    const name = statusInstance(row);
    if (name === "" || seen.has(name)) {
      continue;
    }
    seen.add(name);
    views.push(identityView(environment, name, row.certificate, nowSecs));
  }
  return views;
};

/** Label for the instance list; omitted load is an older or pending server. */
export const identityColumn = (
  load: StatusLoad | undefined,
  view: IdentityView | undefined,
): { label: string; tone: HealthTone } => {
  if (load?.kind !== "ok") {
    return { label: "n/a", tone: "muted" };
  }
  if (view === undefined) {
    return { label: "none", tone: "muted" };
  }
  return { label: view.state, tone: view.tone };
};
