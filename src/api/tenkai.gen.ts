// Generated from Sannrox/tenkai api/tenkai-http-v1.schema.json at ee98ea9a532a7be6ddb6c0f0b98ea5047f95018b (contract tenkai.http.v1).
// Do not edit: run `pnpm api:gen`.

/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "CheckpointClass".
 */
export type CheckpointClass = ("reversible" | "compensating" | "irreversible")
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "CompatibilityStatus".
 */
export type CompatibilityStatus = ("compatible" | "incompatible")
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "EnvironmentStatus".
 */
export type EnvironmentStatus = ({
state: "current"
} | {
plan_id: string
state: "applied"
steps: number
} | {
plan_id: string
state: "awaiting_runtime"
steps: number
} | {
plan_id: string
state: "awaiting_approval"
steps: number
} | {
error: string
state: "failed"
} | {
retry_at: number
state: "deferred"
} | {
state: "busy"
})
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "MigrationStatus".
 */
export type MigrationStatus = ("admitted" | "running" | "succeeded" | "failed" | "rolled_back" | "recovery_required")

export interface TenkaiHttpV1 {
ApplyRequest?: ApplyRequest
ApprovalEnvelope?: ApprovalEnvelope
ApprovalStatement?: ApprovalStatement
ApprovalTrustRoots?: ApprovalTrustRoots
ApprovalTrustedSigner?: ApprovalTrustedSigner
ApproveRequest?: ApproveRequest
CheckpointClass?: CheckpointClass
CheckpointDecl?: CheckpointDecl
CheckpointReceipt?: CheckpointReceipt
CompatibilityEvidence?: CompatibilityEvidence
CompatibilityStatus?: CompatibilityStatus
EnvironmentInspectReport?: EnvironmentInspectReport
EnvironmentLeaseInspect?: EnvironmentLeaseInspect
EnvironmentListEntry?: EnvironmentListEntry
EnvironmentPlanStepSummary?: EnvironmentPlanStepSummary
EnvironmentPlanSummary?: EnvironmentPlanSummary
EnvironmentResult?: EnvironmentResult
EnvironmentRetirement?: EnvironmentRetirement
EnvironmentStatus?: EnvironmentStatus
EnvironmentSubscriptionView?: EnvironmentSubscriptionView
ErrorBody?: ErrorBody
FleetEnvironmentRow?: FleetEnvironmentRow
FleetStatusReport?: FleetStatusReport
ManagementLifecycleResult?: ManagementLifecycleResult
MigrationApprovalEnvelope?: MigrationApprovalEnvelope
MigrationApprovalStatement?: MigrationApprovalStatement
MigrationDeclaration?: MigrationDeclaration
MigrationRecord?: MigrationRecord
MigrationStatus?: MigrationStatus
ModuleActivationReceipt?: ModuleActivationReceipt
OidcClientDiscovery?: OidcClientDiscovery
PackageMigrationApplyRequest?: PackageMigrationApplyRequest
PackageMigrationMutateRequest?: PackageMigrationMutateRequest
PackageMigrationPreviewRequest?: PackageMigrationPreviewRequest
PackageMigrationResult?: PackageMigrationResult
PackagePin?: PackagePin
PlanApprovalTrustRoots?: PlanApprovalTrustRoots
PlanApprovalTrustedSigner?: PlanApprovalTrustedSigner
PlanRequest?: PlanRequest
PreviewInspect?: PreviewInspect
PromoteRequest?: PromoteRequest
Provenance?: Provenance
PublishRequest?: PublishRequest
RecallRequest?: RecallRequest
ReleaseStatement?: ReleaseStatement
ReleaseTrustRoots?: ReleaseTrustRoots
ReleaseTrustedSigner?: ReleaseTrustedSigner
RetireEnvironmentRequest?: RetireEnvironmentRequest
RollbackRequest?: RollbackRequest
ServiceStatus?: ServiceStatus
SignatureEnvelope?: SignatureEnvelope
StatusRow?: StatusRow
SubscribeRequest?: SubscribeRequest
TerminalOutcomeProjection?: TerminalOutcomeProjection
TickReport?: TickReport
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "ApplyRequest".
 */
export interface ApplyRequest {
approval: ApprovalEnvelope
emergency_reason?: (string | null)
environment: string
expected_generation: number
operation: string
skip_gates?: boolean
trust_roots: PlanApprovalTrustRoots
version: number
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "ApprovalEnvelope".
 */
export interface ApprovalEnvelope {
key_id: string
schema: string
signature: string
statement: ApprovalStatement
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "ApprovalStatement".
 */
export interface ApprovalStatement {
environment: string
expires_at: number
issued_at: number
plan_digest: string
policy_digest: string
policy_evidence_id: string
policy_provider: string
purpose: string
skip_gates: boolean
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "PlanApprovalTrustRoots".
 */
export interface PlanApprovalTrustRoots {
signers: PlanApprovalTrustedSigner[]
version: number
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "PlanApprovalTrustedSigner".
 */
export interface PlanApprovalTrustedSigner {
identity: string
key_id: string
public_key: string
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "ApprovalTrustRoots".
 */
export interface ApprovalTrustRoots {
signers: ApprovalTrustedSigner[]
version: number
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "ApprovalTrustedSigner".
 */
export interface ApprovalTrustedSigner {
identity: string
key_id: string
public_key: string
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "ApproveRequest".
 */
export interface ApproveRequest {
approval: ApprovalEnvelope
environment: string
expected_generation: number
operation: string
trust_roots: PlanApprovalTrustRoots
version: number
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "CheckpointDecl".
 */
export interface CheckpointDecl {
class: CheckpointClass
id: string
pre_admission?: (string | null)
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "CheckpointReceipt".
 */
export interface CheckpointReceipt {
checkpoint_id: string
class: CheckpointClass
effect: string
fence_generation: number
plan_id?: (string | null)
result: string
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "CompatibilityEvidence".
 */
export interface CompatibilityEvidence {
evidence_digest: string
status: CompatibilityStatus
version: number
}
/**
 * Detailed inspect report for one environment (no credentials).
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "EnvironmentInspectReport".
 */
export interface EnvironmentInspectReport {
description: string
/**
 * Execution ownership note: Tenkai never prints runtime bearer tokens.
 */
execution_note: string
facts: {
[k: string]: string
}
id: string
/**
 * Most recent plan for this environment by `created_at`, if any.
 */
latest_plan?: (EnvironmentPlanSummary | null)
lease: EnvironmentLeaseInspect
/**
 * Accepted workshop-module activation receipts for this environment.
 */
module_activations?: ModuleActivationReceipt[]
name: string
/**
 * Observed runtime digest used for workshop-module compatibility admission.
 */
observed_runtime_digest?: (string | null)
/**
 * Observed type digest used for workshop-module compatibility admission.
 */
observed_type_digest?: (string | null)
/**
 * Non-secret product overlays as `product.key=value`.
 */
overlays?: {
[k: string]: string
}
/**
 * Present only for preview environments bound to a branch pin.
 */
preview?: (PreviewInspect | null)
/**
 * Present after this environment has been retired from operational use.
 */
retirement?: (EnvironmentRetirement | null)
subscriptions: EnvironmentSubscriptionView[]
/**
 * Bounded terminal-outcome identities and outbox delivery state. Event
 * payloads and retry errors are intentionally excluded.
 */
terminal_outcomes?: TerminalOutcomeProjection[]
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "EnvironmentPlanSummary".
 */
export interface EnvironmentPlanSummary {
created_at: number
id: string
state: string
/**
 * Bounded operator-facing lifecycle detail; never contains executable payloads.
 */
status_detail?: string
step_count: number
/**
 * Ordered, bounded summaries of executable steps.
 */
steps?: EnvironmentPlanStepSummary[]
/**
 * True when `step_count` exceeds the number of returned summaries.
 */
steps_truncated?: boolean
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "EnvironmentPlanStepSummary".
 */
export interface EnvironmentPlanStepSummary {
action: string
from?: (string | null)
id: string
order: number
product: string
release_id: string
to: string
}
/**
 * Operator-facing lease/fence summary. Never includes credentials.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "EnvironmentLeaseInspect".
 */
export interface EnvironmentLeaseInspect {
expires_at_ms?: (number | null)
generation?: (number | null)
/**
 * Whether an active apply/execution lease is held.
 */
held: boolean
/**
 * Lease owner identity (controller id), never a bearer token.
 */
owner?: (string | null)
status: string
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "ModuleActivationReceipt".
 */
export interface ModuleActivationReceipt {
closure_digest: string
environment: string
module_digest: string
module_id: string
pin_digest: string
product: string
receipt_digest: string
release: string
runtime_digest: string
schema: string
type_digest: string
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "PreviewInspect".
 */
export interface PreviewInspect {
expires_at: number
pin_digest: string
plan_digest: string
status: string
teardown_at?: (number | null)
teardown_reason?: (string | null)
}
/**
 * Durable evidence explaining why an environment is no longer operational.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "EnvironmentRetirement".
 */
export interface EnvironmentRetirement {
actor: string
reason: string
retired_at: number
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "EnvironmentSubscriptionView".
 */
export interface EnvironmentSubscriptionView {
applied_overlay?: (string | null)
channel: string
deployed?: (string | null)
error?: (string | null)
head: string
health?: (string | null)
overlay_digest?: (string | null)
product: string
state: string
}
/**
 * Bounded, authenticated read projection of one Tenkai-owned terminal
 * outcome and its optional-provider delivery state. The projection contains
 * identities and digests only; the original event payload and retry error are
 * never returned to an operator or integration client.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "TerminalOutcomeProjection".
 */
export interface TerminalOutcomeProjection {
attempts: number
binding_digest: string
claim_until?: (number | null)
configuration_digest: string
configuration_id: string
delivered_at?: (number | null)
delivery_lag_ms: number
delivery_state: string
deployment_id: string
environment_id: string
event_id: string
next_attempt_at: number
observed_at: number
plan_digest: string
plan_id: string
product: string
release_digest: string
release_id: string
schema: string
terminal_state: string
}
/**
 * Summary row for fleet listing (no credentials).
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "EnvironmentListEntry".
 */
export interface EnvironmentListEntry {
deployed_product_count: number
description: string
id: string
lease_held: boolean
name: string
subscription_count: number
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "EnvironmentResult".
 */
export interface EnvironmentResult {
environment: string
status: EnvironmentStatus
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "ErrorBody".
 */
export interface ErrorBody {
error: string
}
/**
 * One environment's row in a fleet posture table (no credentials).
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "FleetEnvironmentRow".
 */
export interface FleetEnvironmentRow {
description: string
/**
 * `ok` | `unknown` | `error` | `n/a` (no subscriptions).
 */
health_summary: string
id: string
/**
 * Latest plan state when a plan exists. Fleet status leaves this empty;
 * `inspect_environment` is the source for plan detail.
 */
latest_plan_state?: (string | null)
lease_held: boolean
name: string
/**
 * Aggregate posture: `empty` | `unhealthy` | `behind` | `current`.
 */
posture: string
/**
 * Subscribed products with a deployment that is not the channel head.
 */
products_behind: number
/**
 * Subscribed products whose deployed version matches channel head.
 */
products_current: number
/**
 * Subscribed products with no deployed version.
 */
products_missing: number
subscription_count: number
/**
 * True when any subscription has health `unknown` or a non-empty error.
 */
unhealthy: boolean
}
/**
 * Fleet-wide delivery posture (no credentials).
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "FleetStatusReport".
 */
export interface FleetStatusReport {
environment_count: number
environments: FleetEnvironmentRow[]
environments_behind: number
environments_current: number
environments_empty: number
environments_unhealthy: number
}
/**
 * Versioned result shared by catalog lifecycle routes.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "ManagementLifecycleResult".
 */
export interface ManagementLifecycleResult {
digest?: (string | null)
message: string
operation: string
resource?: (string | null)
version: number
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "MigrationApprovalEnvelope".
 */
export interface MigrationApprovalEnvelope {
key_id: string
schema: string
signature: string
statement: MigrationApprovalStatement
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "MigrationApprovalStatement".
 */
export interface MigrationApprovalStatement {
environment: string
expires_at: number
identity_digest: string
issued_at: number
purpose: string
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "MigrationDeclaration".
 */
export interface MigrationDeclaration {
checkpoints: CheckpointDecl[]
compatibility: CompatibilityEvidence
profile: string
source: PackagePin
target: PackagePin
version: number
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "PackagePin".
 */
export interface PackagePin {
digest: string
product: string
version: string
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "MigrationRecord".
 */
export interface MigrationRecord {
approval_digest: string
backup_receipt_digest?: (string | null)
declaration: MigrationDeclaration
environment: string
fence_generation: number
identity_digest: string
name: string
partition?: (string | null)
pending_plan_id?: (string | null)
pending_rollback_plan_id?: (string | null)
receipts: CheckpointReceipt[]
status: MigrationStatus
}
/**
 * Unauthenticated `GET /v1/auth/oidc` body: what a browser needs to start
 * Authorization Code + PKCE. Public values only.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "OidcClientDiscovery".
 */
export interface OidcClientDiscovery {
audience: string
client_id: string
issuer: string
scopes: string[]
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "PackageMigrationApplyRequest".
 */
export interface PackageMigrationApplyRequest {
approval: MigrationApprovalEnvelope
backup_receipt_digest?: (string | null)
declaration: MigrationDeclaration
environment: string
expected_generation: number
plan_approvals?: {
[k: string]: ApprovalEnvelope
}
trust_roots: ApprovalTrustRoots
version: number
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "PackageMigrationMutateRequest".
 */
export interface PackageMigrationMutateRequest {
approval: MigrationApprovalEnvelope
expected_generation: number
plan_approvals?: {
[k: string]: ApprovalEnvelope
}
trust_roots: ApprovalTrustRoots
version: number
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "PackageMigrationPreviewRequest".
 */
export interface PackageMigrationPreviewRequest {
backup_receipt_digest?: (string | null)
declaration: MigrationDeclaration
environment: string
version: number
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "PackageMigrationResult".
 */
export interface PackageMigrationResult {
record: MigrationRecord
version: number
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "PlanRequest".
 */
export interface PlanRequest {
environment: string
expected_generation: number
operation: string
version: number
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "PromoteRequest".
 */
export interface PromoteRequest {
operation: string
spec: string
version: number
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "Provenance".
 */
export interface Provenance {
builder: string
built_at_unix_ms: number
materials?: {
[k: string]: string
}
revision: string
source_uri: string
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "PublishRequest".
 */
export interface PublishRequest {
manifest: string
operation: string
signature: SignatureEnvelope
trust_roots: ReleaseTrustRoots
version: number
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "SignatureEnvelope".
 */
export interface SignatureEnvelope {
key_id: string
schema: string
signature: string
statement: ReleaseStatement
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "ReleaseStatement".
 */
export interface ReleaseStatement {
artifact_digest: string
manifest_digest: string
provenance: Provenance
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "ReleaseTrustRoots".
 */
export interface ReleaseTrustRoots {
signers: ReleaseTrustedSigner[]
version: number
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "ReleaseTrustedSigner".
 */
export interface ReleaseTrustedSigner {
identity: string
key_id: string
public_key: string
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "RecallRequest".
 */
export interface RecallRequest {
operation: string
version: number
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "RetireEnvironmentRequest".
 */
export interface RetireEnvironmentRequest {
operation: string
reason: string
version: number
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "RollbackRequest".
 */
export interface RollbackRequest {
environment: string
expected_generation: number
operation: string
product: string
recovery_reason?: (string | null)
version: number
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "ServiceStatus".
 */
export interface ServiceStatus {
capabilities: string[]
/**
 * API contract ids this server serves, for client compatibility checks.
 */
contracts: string[]
profile: string
status: string
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "StatusRow".
 */
export interface StatusRow {
channel: string
deployed?: (string | null)
error?: (string | null)
head: string
health?: (string | null)
overlay_stale?: boolean
product: string
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "SubscribeRequest".
 */
export interface SubscribeRequest {
environment: string
expected_generation: number
operation: string
spec: string
version: number
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "TickReport".
 */
export interface TickReport {
environments: EnvironmentResult[]
}

export const TENKAI_CONTRACT = "tenkai.http.v1";
