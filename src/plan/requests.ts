import { type } from "arktype";
import { parse as parseToml } from "smol-toml";
import type {
  ApplyRequest,
  ApproveRequest,
  EnvironmentLeaseInspect,
  PlanRequest,
  RollbackRequest,
  SubscribeRequest,
} from "../api/tenkai.gen";

/**
 * Management lifecycle request bodies (tenkai.management-lifecycle.v1).
 * The console never signs: approvals arrive as envelopes produced by
 * `tenkaictl dev sign-approval` and are only checked for shape here; the
 * server verifies signatures, digests, scope, and expiry.
 */

const VERSION = 1;

/** Generation the server expects: the held lease's, or 0 when free. */
export const expectedGeneration = (lease: EnvironmentLeaseInspect): number =>
  lease.held ? (lease.generation ?? 0) : 0;

export const planBody = (environment: string, generation: number): PlanRequest => ({
  version: VERSION,
  operation: "plan",
  environment,
  expected_generation: generation,
});

/** Same spec as `tenkaictl env subscribe <env> <product>=<channel>`. */
export const subscribeBody = (
  environment: string,
  generation: number,
  product: string,
  channel: string,
): SubscribeRequest => ({
  version: VERSION,
  operation: "subscribe",
  environment,
  expected_generation: generation,
  spec: `${product}=${channel}`,
});

export const rollbackBody = (
  environment: string,
  generation: number,
  product: string,
): RollbackRequest => ({
  version: VERSION,
  operation: "rollback",
  environment,
  product,
  expected_generation: generation,
});

const Envelope = type({
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

const TrustRoots = type({
  version: "number",
  signers: type({ identity: "string", key_id: "string", public_key: "string" }).array(),
});

export type Evidence = Pick<ApproveRequest, "approval" | "trust_roots">;

/** `dev sign-approval` writes trust roots as TOML; JSON is accepted too. */
const parseRoots = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return parseToml(text);
  }
};

/** Parse pasted approval evidence; refuses envelopes for another environment. */
export const parseEvidence = (
  environment: string,
  envelopeText: string,
  trustRootsText: string,
): Evidence | string => {
  let envelope: unknown;
  let roots: unknown;
  try {
    envelope = JSON.parse(envelopeText);
  } catch {
    return "The approval must be the JSON file from tenkaictl dev sign-approval.";
  }
  try {
    roots = parseRoots(trustRootsText);
  } catch {
    return "Trust roots must be the TOML (or JSON) file from tenkaictl dev sign-approval.";
  }
  const approval = Envelope(envelope);
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

export const approveBody = (
  environment: string,
  generation: number,
  evidence: Evidence,
): ApproveRequest => ({
  version: VERSION,
  operation: "approve",
  environment,
  expected_generation: generation,
  ...evidence,
});

export const applyBody = (
  environment: string,
  generation: number,
  evidence: Evidence,
): ApplyRequest => ({
  version: VERSION,
  operation: "apply",
  environment,
  expected_generation: generation,
  ...evidence,
});

/** The approver's command; the digest is a placeholder until it is known. */
export const signCommand = (environment: string, digest: string | undefined): string =>
  `tenkaictl dev sign-approval --plan-digest ${digest ?? "<plan digest>"} --env ${environment} --approval approval.json --trust-roots approval-trust.toml`;
