import { type } from "arktype";
import { request } from "../api/http";
import type {
  ApprovalEnvelope,
  CheckpointDecl,
  MigrationDeclaration,
  MigrationListEntry,
  MigrationPage,
  MigrationRecord,
  PackageMigrationApplyRequest,
  PackageMigrationMutateRequest,
  PackageMigrationPreviewRequest,
  PackageMigrationResult,
  PackagePin,
} from "../api/tenkai.gen";
import { TrustRoots, parseRoots } from "../plan/requests";

const VERSION = 1;

const Pin = type({ product: "string", version: "string", digest: "string" });

const Declaration = type({
  version: "number",
  profile: "string",
  source: Pin,
  target: Pin,
  compatibility: {
    version: "number",
    status: "'compatible' | 'incompatible'",
    evidence_digest: "string",
  },
  checkpoints: type({
    id: "string",
    class: "'reversible' | 'compensating' | 'irreversible'",
    "pre_admission?": "string | null",
  }).array(),
});

const MigrationApproval = type({
  schema: "string",
  key_id: "string",
  signature: "string",
  statement: {
    identity_digest: "string",
    environment: "string",
    purpose: "string",
    issued_at: "number",
    expires_at: "number",
  },
});

const PlanApproval = type({
  schema: "string",
  key_id: "string",
  signature: "string",
  statement: {
    environment: "string",
    expires_at: "number",
    issued_at: "number",
    plan_digest: "string",
    policy_digest: "string",
    policy_evidence_id: "string",
    policy_provider: "string",
    purpose: "string",
    skip_gates: "boolean",
  },
});

export type MigrationEvidence = Pick<PackageMigrationApplyRequest, "approval" | "trust_roots">;

/** Last path segment, shortened like plan ids on the plan page. */
export const shortPlan = (id: string): string => id.split(":").at(-1)?.slice(0, 8) ?? id;

/** `GET /v1/migrations` with the catalog page limit. */
export const migrationsPath = (cursor?: string): string => {
  const query = new URLSearchParams({ limit: "100" });
  if (cursor) {
    query.set("cursor", cursor);
  }
  return `v1/migrations?${query.toString()}`;
};

/** Follow `next_cursor` until the server stops paging. */
export const listMigrations = async (
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<MigrationListEntry[]> => {
  const items: MigrationListEntry[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await request<MigrationPage>(migrationsPath(cursor), { token }, fetcher);
    items.push(...page.items);
    if (!page.next_cursor || page.next_cursor === cursor) {
      return items;
    }
    cursor = page.next_cursor;
  }
};

/** Parse pasted declaration JSON; the server still verifies pins and evidence. */
export const parseDeclaration = (text: string): MigrationDeclaration | string => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return "The declaration must be the migration declaration JSON.";
  }
  const declaration = Declaration(raw);
  if (declaration instanceof type.errors) {
    return `Declaration: ${declaration.summary}`;
  }
  return declaration;
};

/** Parse pasted migration approval and trust roots; refuses another environment. */
export const parseMigrationEvidence = (
  environment: string,
  envelopeText: string,
  trustRootsText: string,
): MigrationEvidence | string => {
  let envelope: unknown;
  let roots: unknown;
  try {
    envelope = JSON.parse(envelopeText);
  } catch {
    return "The approval must be the JSON file from tenkaictl migrate apply.";
  }
  try {
    roots = parseRoots(trustRootsText);
  } catch {
    return "Trust roots must be the migration approval trust-roots TOML (or JSON).";
  }
  const approval = MigrationApproval(envelope);
  if (approval instanceof type.errors) {
    return `Approval envelope: ${approval.summary}`;
  }
  const trust = TrustRoots(roots);
  if (trust instanceof type.errors) {
    return `Trust roots: ${trust.summary}`;
  }
  if (approval.statement.environment !== environment) {
    return `This approval is for ${approval.statement.environment}, not ${environment}.`;
  }
  return { approval, trust_roots: trust };
};

/** Parse a compensating plan approval; the map key is the pending plan id. */
export const parsePlanApproval = (text: string): ApprovalEnvelope | string => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return "The plan approval must be the JSON file from tenkaictl dev sign-approval.";
  }
  const approval = PlanApproval(raw);
  if (approval instanceof type.errors) {
    return `Plan approval: ${approval.summary}`;
  }
  return approval;
};

/** Fence the request sends; empty is generation 0. */
export const parseGeneration = (text: string): number | string => {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }
  if (!/^\d+$/.test(trimmed)) {
    return "Generation must be a whole number.";
  }
  return Number(trimmed);
};

const optionalBackup = (digest: string): { backup_receipt_digest: string } | object => {
  const backup = digest.trim();
  return backup ? { backup_receipt_digest: backup } : {};
};

const optionalPlanApprovals = (
  pending: string | undefined,
  envelope: ApprovalEnvelope | undefined,
): { plan_approvals: { [k: string]: ApprovalEnvelope } } | object =>
  pending && envelope ? { plan_approvals: { [pending]: envelope } } : {};

export const previewBody = (
  environment: string,
  declaration: MigrationDeclaration,
  backup: string,
): PackageMigrationPreviewRequest => ({
  version: VERSION,
  environment,
  declaration,
  ...optionalBackup(backup),
});

export const applyBody = (
  environment: string,
  generation: number,
  declaration: MigrationDeclaration,
  evidence: MigrationEvidence,
  backup: string,
  pendingPlanId: string | undefined,
  planApproval: ApprovalEnvelope | undefined,
): PackageMigrationApplyRequest => ({
  version: VERSION,
  environment,
  expected_generation: generation,
  declaration,
  ...evidence,
  ...optionalBackup(backup),
  ...optionalPlanApprovals(pendingPlanId, planApproval),
});

export const mutateBody = (
  generation: number,
  evidence: MigrationEvidence,
  pendingPlanId: string | undefined,
  planApproval: ApprovalEnvelope | undefined,
): PackageMigrationMutateRequest => ({
  version: VERSION,
  expected_generation: generation,
  ...evidence,
  ...optionalPlanApprovals(pendingPlanId, planApproval),
});

export const pinLine = (pin: PackagePin): string => `${pin.product}@${pin.version} ${pin.digest}`;

export const pendingPlan = (
  record: Pick<MigrationRecord, "pending_plan_id" | "pending_rollback_plan_id">,
): string | undefined => record.pending_plan_id ?? record.pending_rollback_plan_id;

export const describeMigration = (result: PackageMigrationResult): string => {
  const pending = pendingPlan(result.record);
  return pending
    ? `${result.record.name} ${result.record.status}, pending plan ${shortPlan(pending)}`
    : `${result.record.name} ${result.record.status}`;
};

export const statusTone = (
  status: MigrationRecord["status"],
): "ok" | "warning" | "danger" | "muted" => {
  switch (status) {
    case "succeeded":
      return "ok";
    case "running":
    case "admitted":
      return "warning";
    case "failed":
    case "recovery_required":
      return "danger";
    default:
      return "muted";
  }
};

export type CheckpointRow = {
  id: string;
  class: CheckpointDecl["class"];
  result: string;
  waiting: boolean;
};

/** Declaration order: receipt result, else the pending compensating plan, else not started. */
export const checkpointRows = (record: MigrationRecord): CheckpointRow[] => {
  const rollback = record.pending_rollback_plan_id;
  const forward = record.pending_plan_id;
  const lastCompensating = record.declaration.checkpoints.findLast(
    (checkpoint) =>
      checkpoint.class === "compensating" &&
      record.receipts.some((item) => item.checkpoint_id === checkpoint.id),
  )?.id;
  let waitingAssigned = false;
  return record.declaration.checkpoints.map((checkpoint) => {
    if (rollback && checkpoint.id === lastCompensating) {
      return {
        id: checkpoint.id,
        class: checkpoint.class,
        result: `waiting plan ${shortPlan(rollback)}`,
        waiting: true,
      };
    }
    // One receipt per checkpoint: execute refuses a duplicate id; rollback rewrites result in place.
    const receipt = record.receipts.find((item) => item.checkpoint_id === checkpoint.id);
    if (receipt) {
      return { id: checkpoint.id, class: checkpoint.class, result: receipt.result, waiting: false };
    }
    if (!waitingAssigned && forward && checkpoint.class === "compensating") {
      waitingAssigned = true;
      return {
        id: checkpoint.id,
        class: checkpoint.class,
        result: `waiting plan ${shortPlan(forward)}`,
        waiting: true,
      };
    }
    return { id: checkpoint.id, class: checkpoint.class, result: "not started", waiting: false };
  });
};
