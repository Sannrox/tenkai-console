import { type } from "arktype";
import { ApiError, request } from "../api/http";
import type { EffectiveApprovalPolicy } from "../api/tenkai.gen";
import type { AuthSession } from "../auth/identity";

const Runtime = type({
  instance: "string",
  attached_at: "number",
  "closed_at?": "number",
  "stream_error?": "string",
  "+": "delete",
});

const Session = type({
  id: "string",
  environment: "string",
  instance: "string",
  subject: "string",
  opened_by: "string",
  mode: "'read'",
  reason: "string",
  opened_at: "number",
  not_after: "number",
  state: "'open' | 'closed' | 'expired'",
  "close_reason?": "string",
  "closed_at?": "number",
  "closed_by?": "string",
  "runtime?": Runtime,
  "+": "delete",
});

const SessionList = type({
  sessions: Session.array(),
  "+": "delete",
});

const ElevationApproval = type({
  identity: "string",
  key_id: "string",
  approved_at: "number",
  "+": "delete",
});

const Elevation = type({
  id: "string",
  session: "string",
  environment: "string",
  requested_by: "string",
  requester: "string",
  reason: "string",
  requested_at: "number",
  duration_ms: "number",
  state: "'pending' | 'active' | 'ended'",
  approvals: ElevationApproval.array(),
  "active_from?": "number",
  "not_after?": "number",
  "end_reason?": "string",
  "ended_at?": "number",
  "revoked_by?": "string",
  "+": "delete",
});

const ElevationList = type({
  elevations: Elevation.array(),
  "+": "delete",
});

const Envelope = type({
  schema: "string",
  key_id: "string",
  signature: "string",
  statement: {
    session: "string",
    elevation: "string",
    environment: "string",
    purpose: "string",
    issued_at: "number",
    expires_at: "number",
  },
  "+": "delete",
});

export type DebugSession = typeof Session.infer;
export type DebugElevation = typeof Elevation.infer;
export type ElevationEnvelope = typeof Envelope.infer;

export type SessionsLoad =
  | { kind: "ok"; value: DebugSession[] }
  | { kind: "unavailable" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string };

export const ELEVATION_SCHEMA = "tenkai.debug-elevation-approval.v1";
export const ELEVATION_PURPOSE = "debug_elevate";

export const sessionsPath = (environment: string): string =>
  `v1/debug-sessions?environment=${encodeURIComponent(environment)}`;

export const sessionPath = (id: string): string => `v1/debug-sessions/${encodeURIComponent(id)}`;

export const elevationsPath = (id: string): string => `${sessionPath(id)}/elevations`;

/** Debug is a human grant. Agents and the management token never see the control. */
export const offerDebug = (me: AuthSession | null | undefined): boolean =>
  me?.kind === "human" && me.capabilities.includes("debug");

/** Absent policy is forbid, including servers that predate the field. */
export const debugPolicy = (
  policy: Pick<EffectiveApprovalPolicy, "debug_sessions"> | undefined,
): "forbid" | "read" | "elevate" =>
  policy?.debug_sessions === "read" || policy?.debug_sessions === "elevate"
    ? policy.debug_sessions
    : "forbid";

export const remainingLabel = (notAfter: number, now: number): string => {
  const minutes = Math.max(0, Math.floor((notAfter - now) / 60_000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours === 0 ? `${rest}m` : `${hours}h ${rest}m`;
};

export const liveSession = (
  sessions: readonly DebugSession[],
  instance: string,
): DebugSession | undefined =>
  sessions.find((session) => session.instance === instance && session.state === "open");

export const instanceHistory = (
  sessions: readonly DebugSession[],
  instance: string,
): DebugSession[] => sessions.filter((session) => session.instance === instance);

/** Approvals that count toward quorum: not the requester, one per identity. */
export const countedApprovals = (elevation: DebugElevation): number =>
  new Set(
    elevation.approvals
      .filter((approval) => approval.identity !== elevation.requested_by)
      .map((approval) => approval.identity),
  ).size;

export const elevationNeed = (policy: EffectiveApprovalPolicy | undefined): number => {
  const rule = policy?.quorums?.find((item) => item.purpose === "debug_elevate");
  return rule?.n ?? 1;
};

const loadError = (error: unknown): SessionsLoad => {
  if (!(error instanceof ApiError)) {
    return { kind: "error", message: "Could not load" };
  }
  if (error.status === 404 || error.status === 405) {
    return { kind: "unavailable" };
  }
  if (error.status === 403) {
    return { kind: "forbidden" };
  }
  return {
    kind: "error",
    message: /HTTP \d{3}|\/v1\//.test(error.message) ? "Could not load" : error.message,
  };
};

export const fetchSessions = async (
  environment: string,
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<SessionsLoad> => {
  let raw: unknown;
  try {
    raw = await request<unknown>(sessionsPath(environment), { token }, fetcher);
  } catch (error) {
    return loadError(error);
  }
  const value = SessionList(raw);
  return value instanceof type.errors
    ? { kind: "error", message: "Could not load" }
    : { kind: "ok", value: value.sessions };
};

export const fetchElevations = async (
  session: string,
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<DebugElevation[] | undefined> => {
  let raw: unknown;
  try {
    raw = await request<unknown>(elevationsPath(session), { token }, fetcher);
  } catch {
    return undefined;
  }
  const value = ElevationList(raw);
  return value instanceof type.errors ? undefined : value.elevations;
};

export const liveElevation = (
  elevations: readonly DebugElevation[] | undefined,
): DebugElevation | undefined =>
  elevations?.find((item) => item.state === "pending" || item.state === "active");

/**
 * Shape-check a pasted elevation envelope. The server verifies the signature.
 */
export const parseElevationApproval = (
  environment: string,
  session: string,
  elevation: string,
  text: string,
): ElevationEnvelope | string => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return "The approval must be the JSON file from the signed elevation envelope.";
  }
  const approval = Envelope(raw);
  if (approval instanceof type.errors) {
    return `Approval envelope: ${approval.summary}`;
  }
  if (approval.schema !== ELEVATION_SCHEMA || approval.statement.purpose !== ELEVATION_PURPOSE) {
    return "This approval is not a debug elevation envelope.";
  }
  if (approval.statement.environment !== environment) {
    return `This approval is for ${approval.statement.environment}, not ${environment}.`;
  }
  if (approval.statement.session !== session) {
    return "This approval is for a different session.";
  }
  if (approval.statement.elevation !== elevation) {
    return "This approval is for a different elevation.";
  }
  return approval;
};
