// Generated from Sannrox/tenkai api/tenkai-http-v1.schema.json at dbebcc9a02a044fba6d66a9aba5505ff77dbba3c (contract tenkai.http.v1).
// Do not edit: run `pnpm api:gen`.

/**
 * Whether an entry shows material the server loaded and uses, or a file as
 * it is on disk now, which a client that read it at startup adopts only
 * once restarted.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "TrustSource".
 */
export type TrustSource = ("loaded" | "file")
/**
 * Closed set of change-event kinds advertised on the HTTP contract.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "ChangeEventKind".
 */
export type ChangeEventKind = ("plan_created" | "plan_approved" | "plan_applied" | "target_failed" | "target_held" | "target_retried" | "hold_set" | "hold_released" | "release_published" | "release_promoted" | "release_recalled" | "compatibility_result_recorded" | "trust_threshold_crossed")
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
 * via the `definition` "ComponentPin".
 */
export type ComponentPin = ({
kind: "revision"
value: string
} | {
kind: "digest"
value: string
})
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "MigrationState".
 */
export type MigrationState = ("stable" | "pending")
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "CompatibilityFailure".
 */
export type CompatibilityFailure = ({
reason: "missing_evidence"
} | {
reason: "invalid_evidence"
} | {
reason: "ambiguous_evidence"
} | {
reason: "preflight_unavailable"
} | {
component: string
reason: "ambiguous_component"
} | {
reason: "release_binding"
} | {
reason: "environment_binding"
} | {
reason: "stale_evidence"
} | {
component: string
reason: "missing_component"
} | {
component: string
reason: "component_changed"
} | {
capability: string
reason: "missing_capability"
} | {
fact: string
reason: "unsatisfied_fact"
} | {
contract: string
reason: "missing_contract"
} | {
contract: string
reason: "ambiguous_contract"
} | {
contract: string
reason: "incompatible_contract"
} | {
reason: "unsupported_schema"
} | {
reason: "migration_state"
})
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "ConnectivityClass".
 */
export type ConnectivityClass = ("connected" | "intermittent" | "isolated")
/**
 * Purpose a quorum rule applies to. Derived from the plan and apply flags;
 * the v1 envelope purpose stays `execute_plan`.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "QuorumPurpose".
 */
export type QuorumPurpose = ("execute_plan" | "rollback" | "skip_gates" | "downgrade")
/**
 * One configuration change. The variant decides the route: its resource
 * path and whether it is a `PUT` or a `DELETE`.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "EnvironmentConfigChange".
 */
export type EnvironmentConfigChange = ({
key: string
kind: "set_fact"
value: string
} | {
key: string
kind: "clear_fact"
} | {
constraint: string
kind: "set_constraint"
name: string
value: string
} | {
constraint: string
kind: "clear_constraint"
name: string
} | {
duration_minutes: number
kind: "set_maintenance_window"
name: string
start: string
timezone: string
weekdays: number[]
} | {
kind: "remove_maintenance_window"
name: string
} | {
events?: WebhookEvent[]
kind: "set_webhook"
/**
 * Operational events the endpoint also receives (#724).
 */
operational?: OperationalEvent[]
secret_env: string
url: string
} | {
kind: "clear_webhooks"
url?: (string | null)
} | {
kind: "set_approval_policy"
path: string
} | {
kind: "clear_approval_policy"
} | {
kind: "set_runner_attestation"
max_age_ms: number
} | {
kind: "clear_runner_attestation"
})
/**
 * Stable apply-lifecycle events a webhook endpoint may subscribe to.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "WebhookEvent".
 */
export type WebhookEvent = ("apply.succeeded" | "apply.failed" | "apply.rolled_back")
/**
 * Operational events of [`crate::operational_events`] (#724). They live in
 * their own endpoint field, `operational`, so a version that does not know
 * them ignores the field and keeps the endpoint's apply subscriptions.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "OperationalEvent".
 */
export type OperationalEvent = (("plan.held" | "plan.awaiting_approval" | "import.failed" | "backup.stale" | "clock.drift") | "trust.expiring" | "runner.attestation_refused")
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
plan_id: string
reason: string
scope: string
state: "held"
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
 * via the `definition` "EvaluationOutcome".
 */
export type EvaluationOutcome = ("passed" | "failed")
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "ExportAction".
 */
export type ExportAction = ("created" | "downloaded")
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "ExportKind".
 */
export type ExportKind = ("support-bundle" | "audit-export" | "recovery-bundle" | "offline-receipt")
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "ImportState".
 */
export type ImportState = (("running" | "succeeded" | "failed") | "previewed")
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "MigrationStatus".
 */
export type MigrationStatus = ("admitted" | "running" | "succeeded" | "failed" | "rolled_back" | "recovery_required")
/**
 * How a runner authenticates (#809), from what the server issued it, not
 * from what a request presented.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "RunnerAuth".
 */
export type RunnerAuth = ("client_certificate" | "bearer")
/**
 * Whether a trust root's format records when each signer is valid.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "SignerValidity".
 */
export type SignerValidity = "not_recorded"
/**
 * Status ordering: `ok` < `warning` < `critical` < `expired`.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "TrustStatus".
 */
export type TrustStatus = ("ok" | "warning" | "critical" | "expired")

export interface TenkaiHttpV1 {
ApplyRequest?: ApplyRequest
ApprovalEnvelope?: ApprovalEnvelope
ApprovalStatement?: ApprovalStatement
ApprovalTrustRoots?: ApprovalTrustRoots
ApprovalTrustedSigner?: ApprovalTrustedSigner
ApproveRequest?: ApproveRequest
BackupFailure?: BackupFailure
BackupHealth?: BackupHealth
BackupManifest?: BackupManifest
BackupStatus?: BackupStatus
BindPreview?: BindPreview
CertificateEntry?: CertificateEntry
ChangeEvent?: ChangeEvent
ChangeEventKind?: ChangeEventKind
ChangeEventPage?: ChangeEventPage
ChannelHoldRequest?: ChannelHoldRequest
ChannelListEntry?: ChannelListEntry
ChannelPage?: ChannelPage
CheckpointClass?: CheckpointClass
CheckpointDecl?: CheckpointDecl
CheckpointReceipt?: CheckpointReceipt
ClockHealth?: ClockHealth
CollectedApproval?: CollectedApproval
CompatibilityEvidence?: CompatibilityEvidence
CompatibilityEvidence2?: CompatibilityEvidence2
CompatibilityFailure?: CompatibilityFailure
CompatibilityReport?: CompatibilityReport
CompatibilityStatus?: CompatibilityStatus
ComponentObservation?: ComponentObservation
ComponentPin?: ComponentPin
ConnectivityClass?: ConnectivityClass
ContentInventory?: ContentInventory
ContentItem?: ContentItem
CredentialRunway?: CredentialRunway
DeliveryHold?: DeliveryHold
DeliveryHoldRequest?: DeliveryHoldRequest
DeliveryHoldView?: DeliveryHoldView
DrillEvidence?: DrillEvidence
EffectiveApprovalPolicy?: EffectiveApprovalPolicy
EnvironmentConfigChange?: EnvironmentConfigChange
EnvironmentConfigRequest?: EnvironmentConfigRequest
EnvironmentConstraint?: EnvironmentConstraint
EnvironmentInspectReport?: EnvironmentInspectReport
EnvironmentLeaseInspect?: EnvironmentLeaseInspect
EnvironmentListEntry?: EnvironmentListEntry
EnvironmentMaintenanceInspect?: EnvironmentMaintenanceInspect1
EnvironmentMaintenanceWindow?: EnvironmentMaintenanceWindow
EnvironmentPlanStepSummary?: EnvironmentPlanStepSummary
EnvironmentPlanSummary?: EnvironmentPlanSummary
EnvironmentResult?: EnvironmentResult
EnvironmentRetirement?: EnvironmentRetirement1
EnvironmentRuntimeReport?: EnvironmentRuntimeReport
EnvironmentStatus?: EnvironmentStatus
EnvironmentSubscriptionView?: EnvironmentSubscriptionView
ErrorBody?: ErrorBody
EvaluationOutcome?: EvaluationOutcome
EvaluationTrustRoots?: EvaluationTrustRoots
EvaluationTrustedSigner?: EvaluationTrustedSigner
EvidenceSigner?: EvidenceSigner
ExportAction?: ExportAction
ExportEntry?: ExportEntry
ExportEvent?: ExportEvent
ExportKind?: ExportKind
ExportList?: ExportList
ExportRequest?: ExportRequest
FleetEnvironmentRow?: FleetEnvironmentRow
FleetStatusReport?: FleetStatusReport
HoldAuditEvent?: HoldAuditEvent
ImportJob?: ImportJob
ImportRequest?: ImportRequest
ImportState?: ImportState
InstalledRevocations?: InstalledRevocations
ManagementLifecycleResult?: ManagementLifecycleResult
MigrationApprovalEnvelope?: MigrationApprovalEnvelope
MigrationApprovalStatement?: MigrationApprovalStatement
MigrationDeclaration?: MigrationDeclaration
MigrationListEntry?: MigrationListEntry
MigrationPage?: MigrationPage
MigrationRecord?: MigrationRecord
MigrationState?: MigrationState
MigrationStatus?: MigrationStatus
ModelEvaluationEvidence?: ModelEvaluationEvidence
ModelReleaseIdentity?: ModelReleaseIdentity
ModuleActivationReceipt?: ModuleActivationReceipt
ObservedInitJob?: ObservedInitJob
ObservedModelRuntime?: ObservedModelRuntime
ObservedRuntimeComponent?: ObservedRuntimeComponent
ObservedRuntimeUnit?: ObservedRuntimeUnit
OidcClientDiscovery?: OidcClientDiscovery
OperationalEvent?: OperationalEvent
PackageMigrationApplyRequest?: PackageMigrationApplyRequest
PackageMigrationMutateRequest?: PackageMigrationMutateRequest
PackageMigrationPreviewRequest?: PackageMigrationPreviewRequest
PackageMigrationResult?: PackageMigrationResult
PackagePin?: PackagePin
PageQuery?: PageQuery
PlanApprovalTrustRoots?: PlanApprovalTrustRoots
PlanApprovalTrustedSigner?: PlanApprovalTrustedSigner
PlanApprovalView?: PlanApprovalView1
PlanApprovalsView?: PlanApprovalsView
PlanRequest?: PlanRequest
PlanRunway?: PlanRunway
PlanRunways?: PlanRunways
PreviewInspect?: PreviewInspect1
PromoteRequest?: PromoteRequest
Provenance?: Provenance
PublishRequest?: PublishRequest
QuorumPurpose?: QuorumPurpose
QuorumRule?: QuorumRule
RecallRequest?: RecallRequest
RegisterEnvironmentRequest?: RegisterEnvironmentRequest
ReleaseContent?: ReleaseContent
ReleaseListEntry?: ReleaseListEntry
ReleasePage?: ReleasePage
ReleaseStatement?: ReleaseStatement
ReleaseTrustRoots?: ReleaseTrustRoots
ReleaseTrustedSigner?: ReleaseTrustedSigner
RetireEnvironmentRequest?: RetireEnvironmentRequest
RetryFailedTargetRequest?: RetryFailedTargetRequest
RollbackRequest?: RollbackRequest
RunnerAuth?: RunnerAuth
RuntimeCredentialRevoked?: RuntimeCredentialRevoked
RuntimeEnrollmentIssued?: RuntimeEnrollmentIssued
RuntimeEnrollmentRequest?: RuntimeEnrollmentRequest
RuntimeRevokeRequest?: RuntimeRevokeRequest
RuntimeRunner?: RuntimeRunner
RuntimeRunnerAttestation?: RuntimeRunnerAttestation1
RuntimeRunnerInstance?: RuntimeRunnerInstance
RuntimeRunnerList?: RuntimeRunnerList
ScanEvidence?: ScanEvidence1
ServiceStatus?: ServiceStatus
SignatureEnvelope?: SignatureEnvelope
SignerValidity?: SignerValidity
SigningRoot?: SigningRoot
StagedBundle?: StagedBundle
StatusRow?: StatusRow
SubscribeRequest?: SubscribeRequest
TerminalOutcomeProjection?: TerminalOutcomeProjection
TickReport?: TickReport
TrustPosture?: TrustPosture
TrustSource?: TrustSource
TrustStatus?: TrustStatus
TrustedSignerView?: TrustedSignerView
WebhookDelivery?: WebhookDelivery
WebhookEndpoint?: WebhookEndpoint
WebhookEvent?: WebhookEvent
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "ApplyRequest".
 */
export interface ApplyRequest {
approval: ApprovalEnvelope
approvals?: ApprovalEnvelope[]
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
environments?: string[]
groups?: string[]
identity: string
key_id: string
providers?: string[]
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
 * via the `definition` "BackupFailure".
 */
export interface BackupFailure {
at_ms: number
error: string
}
/**
 * Backup age as health reports it.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "BackupHealth".
 */
export interface BackupHealth {
age_seconds?: number
max_age_seconds: number
/**
 * `ok`, `stale` (older than the threshold), `missing` (none taken yet)
 * or `unreadable` (the status file cannot be read).
 */
state: string
}
/**
 * One completed backup, as its manifest records it.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "BackupManifest".
 */
export interface BackupManifest {
/**
 * File name inside the backup directory.
 */
file: string
schema: string
sha256: string
size_bytes: number
taken_at_ms: number
/**
 * The tool that took a recorded database-native backup. Absent on
 * backups this module takes, so their manifests are unchanged.
 */
tool?: string
}
/**
 * `GET /v1/backups`: `status.json` plus the newest drill.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "BackupStatus".
 */
export interface BackupStatus {
last_drill?: DrillEvidence
last_failure?: BackupFailure
last_success?: BackupManifest
schema: string
}
/**
 * Evidence that one backup restored into a scratch store and opened.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "DrillEvidence".
 */
export interface DrillEvidence {
environments: number
file: string
/**
 * `PRAGMA integrity_check` of the restored store.
 */
integrity: string
plans: number
releases: number
restored_at_ms: number
schema: string
sha256: string
}
/**
 * What binding a bundle would do, without writing anything.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "BindPreview".
 */
export interface BindPreview {
/**
 * True when the environment already has this bundle bound (a replay).
 */
already_bound: boolean
bundle_digest: string
/**
 * True when the bundle carries a key revocation list to install.
 */
carries_revocations: boolean
plan_id: string
release_ids: string[]
scan?: ScanEvidence
}
/**
 * The import scanner's outcome, when one is configured.
 */
export interface ScanEvidence {
exit_code: number
scanned_at_ms: number
scanner: string
stderr_sha256: string
/**
 * SHA-256 of the scanner's standard output and standard error, so the
 * full report can be matched to the scanner's own logs.
 */
stdout_sha256: string
/**
 * The first line of output (standard output, else standard error), at
 * most 200 bytes.
 */
summary: string
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "CertificateEntry".
 */
export interface CertificateEntry {
days_left?: number
error?: string
file: string
/**
 * Unix seconds.
 */
not_after?: number
purpose: string
/**
 * SHA-256 of the certificate's DER, as `openssl x509 -fingerprint
 * -sha256` prints it: uppercase hex pairs joined by colons (#809).
 */
sha256_fingerprint?: string
source: TrustSource
/**
 * An unreadable certificate file is `critical`.
 */
status: ("ok" | "warning" | "critical" | "expired")
subject?: string
}
/**
 * One durable change. `cursor` is the opaque resume token (monotonic sequence).
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "ChangeEvent".
 */
export interface ChangeEvent {
cursor: string
environment?: string
kind: ChangeEventKind
occurred_at: number
resource: string
}
/**
 * Bounded page of change events plus the cursor to resume from.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "ChangeEventPage".
 */
export interface ChangeEventPage {
events: ChangeEvent[]
next_cursor: string
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "ChannelHoldRequest".
 */
export interface ChannelHoldRequest {
operation: string
reason?: (string | null)
version: number
}
/**
 * Identifying fields, current head, and active hold for one channel.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "ChannelListEntry".
 */
export interface ChannelListEntry {
head: string
hold?: DeliveryHold
id: string
name: string
product: string
}
/**
 * Durable evidence that delivery is paused for a scope.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "DeliveryHold".
 */
export interface DeliveryHold {
actor: string
held_at: number
reason: string
}
/**
 * One page of [`ChannelListEntry`] values.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "ChannelPage".
 */
export interface ChannelPage {
items: ChannelListEntry[]
next_cursor?: string
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
plan_id?: string
result: string
}
/**
 * The last clock reading, as health reports it.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "ClockHealth".
 */
export interface ClockHealth {
measured_at_ms?: number
refuse_ms: number
/**
 * Time-source time minus local time, from the last successful reading.
 */
skew_ms?: number
/**
 * `ok`, `warn`, `refuse`, or `unknown` (no successful reading yet, or the
 * last measurement failed).
 */
state: string
warn_ms: number
}
/**
 * One collected, still-detached envelope for a plan.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "CollectedApproval".
 */
export interface CollectedApproval {
expires_at: number
groups?: string[]
key_id: string
signer_identity: string
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
 * Observations describe the candidate's constituents and installed dependencies.
 * The environment owner supplies this evidence; it grants no execution authority.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "CompatibilityEvidence2".
 */
export interface CompatibilityEvidence2 {
capabilities: string[]
components: {
[k: string]: ComponentObservation
}
contracts: {
[k: string]: string
}
environment: string
migration: MigrationState
observed_at_ms: number
release_digest: string
schema_version?: (number | null)
version: number
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "ComponentObservation".
 */
export interface ComponentObservation {
pin: ComponentPin
provides: {
[k: string]: string
}
requires?: {
[k: string]: string
}
}
/**
 * Public reports contain requirement identifiers, never observed facts or payloads.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "CompatibilityReport".
 */
export interface CompatibilityReport {
failures: CompatibilityFailure[]
release_digest: string
version: number
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "ContentInventory".
 */
export interface ContentInventory {
/**
 * Referenced content this host holds no bytes for, as `<release> <digest>`.
 */
missing: string[]
/**
 * Bytes under the OCI store; absent when no store is configured.
 */
oci_store_bytes?: number
releases: ReleaseContent[]
/**
 * Bytes under the weight cache; absent when no cache is configured.
 */
weight_cache_bytes?: number
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "ReleaseContent".
 */
export interface ReleaseContent {
content: ContentItem[]
id: string
product: string
/**
 * `channel <product>/<channel>` heads and `deployed <environment>`.
 */
referenced_by: string[]
version: string
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "ContentItem".
 */
export interface ContentItem {
digest: string
/**
 * `layer` or `weights`.
 */
kind: string
size_bytes?: number
/**
 * Whether this host holds a file named for this digest: a layer under
 * any registry path of the OCI store, a weight in the cache. Files are
 * found by name and not re-hashed here; import, apply and fetch verify
 * the bytes. An environment still pulls a layer through its own mirror
 * path. Absent when the store that would hold it is not configured.
 */
stored?: boolean
}
/**
 * A certificate that lapses before an environment's next maintenance window
 * opens, so a plan waiting for that window would fail at apply time (#778).
 * Advisory: it never blocks the plan or changes its steps.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "CredentialRunway".
 */
export interface CredentialRunway {
/**
 * The certificate's purpose, with its subject when readable.
 */
credential: string
expires_at_ms: number
window_opens_at_ms: number
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "DeliveryHoldRequest".
 */
export interface DeliveryHoldRequest {
environment: string
expected_generation: number
operation: string
reason?: (string | null)
version: number
}
/**
 * Active hold plus set/clear/retry history for one scope.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "DeliveryHoldView".
 */
export interface DeliveryHoldView {
audit: HoldAuditEvent[]
hold?: DeliveryHold
}
/**
 * One immutable set, clear, or retry transition.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "HoldAuditEvent".
 */
export interface HoldAuditEvent {
action: string
actor: string
at: number
reason: string
}
/**
 * Operator-facing policy: automatic signer key ids, human rules, and TTL.
 * Never includes seed bytes or file contents.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "EffectiveApprovalPolicy".
 */
export interface EffectiveApprovalPolicy {
auto_signers?: string[]
configured: boolean
digest?: string
mode: string
quorums?: QuorumRule[]
require_human?: string[]
ttl_ms?: number
}
/**
 * N distinct human signers from named groups for one purpose.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "QuorumRule".
 */
export interface QuorumRule {
/**
 * When true, the apply requester's principal cannot count toward N.
 */
exclude_requester?: boolean
groups?: string[]
n: number
purpose: QuorumPurpose
}
/**
 * Body of every `PUT`/`DELETE` configuration route.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "EnvironmentConfigRequest".
 */
export interface EnvironmentConfigRequest {
change: EnvironmentConfigChange
environment: string
expected_generation: number
operation: string
reason: string
version: number
}
/**
 * One environment constraint, as set by `tenkaictl env constraints set`.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "EnvironmentConstraint".
 */
export interface EnvironmentConstraint {
/**
 * `version_pin`, `version_range`, or `require_fact`.
 */
kind: string
/**
 * Product for version constraints; fact key for `require_fact`.
 */
name: string
value: string
}
/**
 * Detailed inspect report for one environment (no credentials).
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "EnvironmentInspectReport".
 */
export interface EnvironmentInspectReport {
/**
 * The plan approval policy file this environment uses, as configured,
 * when one is set (#820).
 */
approval_policy?: string
/**
 * Environment constraints (`version_pin`, `version_range`, `require_fact`).
 */
constraints?: EnvironmentConstraint[]
delivery_hold?: DeliveryHold1
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
maintenance?: EnvironmentMaintenanceInspect
/**
 * Accepted workshop-module activation receipts for this environment.
 */
module_activations?: ModuleActivationReceipt[]
name: string
/**
 * Observed runtime digest used for workshop-module compatibility admission.
 */
observed_runtime_digest?: string
/**
 * Observed type digest used for workshop-module compatibility admission.
 */
observed_type_digest?: string
/**
 * Non-secret product overlays as `product.key=value`.
 */
overlays?: {
[k: string]: string
}
preview?: PreviewInspect
retirement?: EnvironmentRetirement
subscriptions: EnvironmentSubscriptionView[]
/**
 * Bounded terminal-outcome identities and outbox delivery state. Event
 * payloads and retry errors are intentionally excluded.
 */
terminal_outcomes?: TerminalOutcomeProjection[]
/**
 * Configured post-deploy webhooks (#820): URL, the name of the variable
 * holding the HMAC secret, and events. The secret itself is never stored
 * or returned. Edits are conditional on `lease.generation`.
 */
webhooks?: WebhookEndpoint[]
}
/**
 * Durable evidence that delivery is paused for a scope.
 */
export interface DeliveryHold1 {
actor: string
held_at: number
reason: string
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "EnvironmentPlanSummary".
 */
export interface EnvironmentPlanSummary {
approval?: PlanApprovalView
created_at: number
/**
 * `sha256:` digest of the versioned executable-plan encoding, the value
 * the plan route returns and approvals bind to. Absent for projections
 * without an executable plan, such as development fixtures.
 */
digest?: string
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
 * Whether the latest plan was approved by policy or still needs a human.
 */
export interface PlanApprovalView {
policy_provider?: string
reason?: string
/**
 * `policy`, `human`, `development`, or `required`.
 */
source: string
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
 * Maintenance windows and their eligibility at inspect time. Absent for
 * projections that do not read Tenkai-owned environment configuration.
 */
export interface EnvironmentMaintenanceInspect {
/**
 * When `invalid`: why the configuration cannot be evaluated.
 */
detail?: string
/**
 * `unrestricted` (no environment windows), `open`, `closed`, or
 * `invalid`. Invalid configuration blocks apply until it is corrected.
 */
eligibility: string
/**
 * When `closed`: next opening of any window, in Unix milliseconds.
 */
next_opens_at_ms?: number
/**
 * When `open`: end of the current window, in Unix milliseconds.
 */
open_until_ms?: number
windows: EnvironmentMaintenanceWindow[]
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "EnvironmentMaintenanceWindow".
 */
export interface EnvironmentMaintenanceWindow {
duration_minutes: number
identity: string
/**
 * Next start of this window strictly after inspect time, in Unix
 * milliseconds; absent when the window cannot be evaluated.
 */
next_opens_at_ms?: number
/**
 * Local wall-clock start in HH:MM form.
 */
start: string
/**
 * IANA timezone of `start`.
 */
timezone: string
/**
 * ISO weekday numbers: Monday is 1 and Sunday is 7.
 */
weekdays: number[]
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
 * Present only for preview environments bound to a branch pin.
 */
export interface PreviewInspect {
expires_at: number
pin_digest: string
plan_digest: string
status: string
teardown_at?: number
teardown_reason?: string
}
/**
 * Present after this environment has been retired from operational use.
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
delivery_hold?: DeliveryHold2
deployed?: (string | null)
error?: (string | null)
head: string
health?: (string | null)
overlay_digest?: (string | null)
product: string
state: string
}
/**
 * Durable evidence that delivery is paused for a scope.
 */
export interface DeliveryHold2 {
actor: string
held_at: number
reason: string
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
 * Operator-facing endpoint configuration. The HMAC secret is never stored;
 * `secret_env` names a process environment variable.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "WebhookEndpoint".
 */
export interface WebhookEndpoint {
events?: WebhookEvent[]
/**
 * Operational events this endpoint also receives; none unless listed.
 */
operational?: OperationalEvent[]
secret_env: string
url: string
}
/**
 * Summary row for fleet listing (no credentials).
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "EnvironmentListEntry".
 */
export interface EnvironmentListEntry {
/**
 * The environment or one of its subscribed channels is held.
 */
delivery_held?: boolean
deployed_product_count: number
description: string
id: string
lease_held: boolean
name: string
subscription_count: number
}
/**
 * Read-only view of the environment's own maintenance schedule, evaluated
 * with the same rules as apply admission. Product maintenance windows
 * (`tenkaictl product maintenance`) are not included and may further
 * restrict when a plan touching that product can apply.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "EnvironmentMaintenanceInspect".
 */
export interface EnvironmentMaintenanceInspect1 {
/**
 * When `invalid`: why the configuration cannot be evaluated.
 */
detail?: string
/**
 * `unrestricted` (no environment windows), `open`, `closed`, or
 * `invalid`. Invalid configuration blocks apply until it is corrected.
 */
eligibility: string
/**
 * When `closed`: next opening of any window, in Unix milliseconds.
 */
next_opens_at_ms?: number
/**
 * When `open`: end of the current window, in Unix milliseconds.
 */
open_until_ms?: number
windows: EnvironmentMaintenanceWindow[]
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
 * Durable evidence explaining why an environment is no longer operational.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "EnvironmentRetirement".
 */
export interface EnvironmentRetirement1 {
actor: string
reason: string
retired_at: number
}
/**
 * GET `/v1/environments/{environment}/runtime` body.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "EnvironmentRuntimeReport".
 */
export interface EnvironmentRuntimeReport {
components: ObservedRuntimeComponent[]
environment: string
}
/**
 * Observed state of one deployed product on an environment.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "ObservedRuntimeComponent".
 */
export interface ObservedRuntimeComponent {
executor_kind: string
health?: string
last_init_job?: ObservedInitJob
model_runtime?: ObservedModelRuntime
product: string
units?: ObservedRuntimeUnit[]
}
/**
 * Last completed one-shot init job for a Docker topology.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "ObservedInitJob".
 */
export interface ObservedInitJob {
exit_code?: number
name: string
status: string
}
/**
 * Observed model_runtime identity and accelerator fit facts.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "ObservedModelRuntime".
 */
export interface ObservedModelRuntime {
accelerator?: string
variant: string
verified_weight_digest: string
}
/**
 * One running or declared Docker unit.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "ObservedRuntimeUnit".
 */
export interface ObservedRuntimeUnit {
health?: string
image_digest: string
name: string
restart_policy: string
running: boolean
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "ErrorBody".
 */
export interface ErrorBody {
error: string
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "EvaluationTrustRoots".
 */
export interface EvaluationTrustRoots {
signers: EvaluationTrustedSigner[]
version: number
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "EvaluationTrustedSigner".
 */
export interface EvaluationTrustedSigner {
key_id: string
public_key: string
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "EvidenceSigner".
 */
export interface EvidenceSigner {
key_id: string
signature: string
}
/**
 * An export with its events, oldest first.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "ExportEntry".
 */
export interface ExportEntry {
created_at_ms: number
/**
 * Set exactly for environment-scoped kinds.
 */
environment?: string
events: ExportEvent[]
/**
 * The name the download carries, as the CLI would name the file.
 */
file_name: string
id: string
kind: ExportKind
schema: string
sha256: string
size_bytes: number
}
/**
 * Who created or downloaded an export, when, and why.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "ExportEvent".
 */
export interface ExportEvent {
action: ExportAction
at_ms: number
principal: string
reason: string
}
/**
 * `GET /v1/exports`, newest first.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "ExportList".
 */
export interface ExportList {
exports: ExportEntry[]
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "ExportRequest".
 */
export interface ExportRequest {
/**
 * Required for `recovery-bundle` and `offline-receipt`, refused otherwise.
 */
environment?: (string | null)
kind: ExportKind
/**
 * The plan of a `recovery-bundle`.
 */
plan_id?: (string | null)
/**
 * Why the export is made; recorded with the creator.
 */
reason: string
/**
 * The connectivity upgrade of an `offline-receipt`.
 */
upgrade?: (string | null)
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
/**
 * The server's own version, which runners and consoles compare
 * against (#761).
 */
server_version?: string
}
/**
 * `GET /v1/imports/{id}` and the job file.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "ImportJob".
 */
export interface ImportJob {
actor: string
bundle: string
dry_run: boolean
environment: string
finished_at_ms?: number
id: string
preview?: BindPreview1
/**
 * The exact refusal, for example a missing layer digest or an expired interval.
 */
refusal?: string
schema: string
started_at_ms: number
state: ImportState
upgrade: string
}
/**
 * What binding a bundle would do, without writing anything.
 */
export interface BindPreview1 {
/**
 * True when the environment already has this bundle bound (a replay).
 */
already_bound: boolean
bundle_digest: string
/**
 * True when the bundle carries a key revocation list to install.
 */
carries_revocations: boolean
plan_id: string
release_ids: string[]
scan?: ScanEvidence
}
/**
 * Body of `POST /v1/imports`.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "ImportRequest".
 */
export interface ImportRequest {
/**
 * File name inside the staging directory.
 */
bundle: string
dry_run?: boolean
environment: string
operation: string
/**
 * The isolated upgrade the bundle binds to.
 */
upgrade: string
version: number
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "InstalledRevocations".
 */
export interface InstalledRevocations {
error?: string
file: string
/**
 * When the installed file was last written, Unix milliseconds: an
 * install or bundle import replaces it, and the process applies it at
 * start (#811).
 */
installed_at?: number
/**
 * When the authority signed the list, Unix milliseconds (#811).
 */
issued_at?: number
revoked_keys: number
sequence?: number
signer_key_id?: string
}
/**
 * Versioned result shared by catalog lifecycle routes.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "ManagementLifecycleResult".
 */
export interface ManagementLifecycleResult {
digest?: string
message: string
operation: string
resource?: string
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
 * Identifying fields and current state for one stored package migration.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "MigrationListEntry".
 */
export interface MigrationListEntry {
environment: string
id: string
name: string
status: MigrationStatus
}
/**
 * One page of [`MigrationListEntry`] values.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "MigrationPage".
 */
export interface MigrationPage {
items: MigrationListEntry[]
next_cursor?: string
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "MigrationRecord".
 */
export interface MigrationRecord {
approval_digest: string
backup_receipt_digest?: string
declaration: MigrationDeclaration
environment: string
fence_generation: number
identity_digest: string
name: string
partition?: string
pending_plan_id?: string
pending_rollback_plan_id?: string
receipts: CheckpointReceipt[]
status: MigrationStatus
}
/**
 * Chisei → Tenkai evaluation result for the same identity.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "ModelEvaluationEvidence".
 */
export interface ModelEvaluationEvidence {
eval_run_id: string
eval_suite_id: string
expires_at: number
identity: ModelReleaseIdentity
observed_at: number
outcome: EvaluationOutcome
schema: string
signer: EvidenceSigner
}
/**
 * Shared model identity for both evidence directions.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "ModelReleaseIdentity".
 */
export interface ModelReleaseIdentity {
artifact_digest: string
endpoint: string
model: string
profile_version: string
provider: string
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
display_name?: string
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
 * Query parameters for cursor-paged catalog lists.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "PageQuery".
 */
export interface PageQuery {
cursor?: (string | null)
limit?: (number | null)
}
/**
 * Whether a plan was approved by policy or still needs a human, and why.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "PlanApprovalView".
 */
export interface PlanApprovalView1 {
policy_provider?: string
reason?: string
/**
 * `policy`, `human`, `development`, or `required`.
 */
source: string
}
/**
 * Collected versus missing approvals for one plan and purpose.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "PlanApprovalsView".
 */
export interface PlanApprovalsView {
collected?: CollectedApproval[]
exclude_requester: boolean
groups?: string[]
missing: number
plan_digest: string
plan_id: string
purpose: string
required: number
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
 * A plan waiting to apply and the first certificate that would lapse
 * before it can (#811).
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "PlanRunway".
 */
export interface PlanRunway {
blocked_by?: CredentialRunway1
environment: string
plan_id: string
/**
 * `computed` or `blocked`.
 */
plan_state: string
/**
 * When the plan can next apply: the environment's next maintenance
 * window, Unix milliseconds. Absent when it may apply now.
 */
window_opens_at_ms?: number
}
/**
 * A certificate that lapses before an environment's next maintenance window
 * opens, so a plan waiting for that window would fail at apply time (#778).
 * Advisory: it never blocks the plan or changes its steps.
 */
export interface CredentialRunway1 {
/**
 * The certificate's purpose, with its subject when readable.
 */
credential: string
expires_at_ms: number
window_opens_at_ms: number
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "PlanRunways".
 */
export interface PlanRunways {
plans: PlanRunway[]
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "PreviewInspect".
 */
export interface PreviewInspect1 {
expires_at: number
pin_digest: string
plan_digest: string
status: string
teardown_at?: number
teardown_reason?: string
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
 * Body of `POST /v1/environments`.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "RegisterEnvironmentRequest".
 */
export interface RegisterEnvironmentRequest {
connectivity_class?: (ConnectivityClass | null)
description?: string
environment: string
operation: string
reason: string
version: number
}
/**
 * Identifying fields and current digest/version for one published release.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "ReleaseListEntry".
 */
export interface ReleaseListEntry {
digest: string
id: string
product: string
version: string
}
/**
 * One page of [`ReleaseListEntry`] values.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "ReleasePage".
 */
export interface ReleasePage {
items: ReleaseListEntry[]
next_cursor?: string
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
 * via the `definition` "RetryFailedTargetRequest".
 */
export interface RetryFailedTargetRequest {
environment: string
expected_generation: number
operation: string
product: string
reason?: (string | null)
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
 * via the `definition` "RuntimeCredentialRevoked".
 */
export interface RuntimeCredentialRevoked {
credential_id: string
environment: string
revoked_at: number
}
/**
 * A new enrollment. `token` is shown only here.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "RuntimeEnrollmentIssued".
 */
export interface RuntimeEnrollmentIssued {
environment: string
expires_at: number
token: string
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "RuntimeEnrollmentRequest".
 */
export interface RuntimeEnrollmentRequest {
/**
 * How long the token may be redeemed; default 15 minutes, at most 24 hours.
 */
ttl_seconds?: (number | null)
}
/**
 * Why a runner is revoked; recorded and shown on inspect.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "RuntimeRevokeRequest".
 */
export interface RuntimeRevokeRequest {
reason: string
}
/**
 * One runner of the registry: an enrolled credential, or a static token
 * configured on the server. Never carries a secret.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "RuntimeRunner".
 */
export interface RuntimeRunner {
attestation?: RuntimeRunnerAttestation
/**
 * How a runner authenticates (#809), from what the server issued it, not
 * from what a request presented.
 */
auth?: ("client_certificate" | "bearer")
created_at?: number
created_by?: string
environment: string
/**
 * `sha256:` digest of the credential or token; what revoke takes.
 */
id: string
/**
 * Instances that presented this runner's credential, most recent first.
 */
instances: RuntimeRunnerInstance[]
revoke_reason?: string
revoked_at?: number
revoked_by?: string
/**
 * `active`, `revoked`, or `static` for a configured token, which only
 * server configuration changes.
 */
state: string
}
/**
 * The latest bound runner attestation and the latest refusal (#675),
 * once the runner was attested or refused.
 */
export interface RuntimeRunnerAttestation {
bound_at?: number
checked_at?: number
/**
 * `sha256:` digest of the latest bound evidence.
 */
evidence_digest?: string
/**
 * `sha256:` fingerprint of the bound runner key.
 */
key_fingerprint?: string
/**
 * The code of the latest refusal since the last binding, for example
 * `fact_mismatch`.
 */
last_refusal?: string
last_refused_at?: number
}
/**
 * What one instance of a runner last did. Activity is recorded at most
 * every 30 seconds per kind, so times can trail by that much.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "RuntimeRunnerInstance".
 */
export interface RuntimeRunnerInstance {
/**
 * Holds an unexpired runtime plan lease now.
 */
holds_lease: boolean
instance_id: string
last_heartbeat_at?: number
last_inventory_at?: number
last_work_at?: number
runtime_version?: string
/**
 * The instance's version against this server: `current`, `behind`
 * (one minor release, supported), `unsupported` or `ahead` (#761).
 */
skew?: string
}
/**
 * A runner's attestation state (#675). Digests only, never evidence content.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "RuntimeRunnerAttestation".
 */
export interface RuntimeRunnerAttestation1 {
bound_at?: number
checked_at?: number
/**
 * `sha256:` digest of the latest bound evidence.
 */
evidence_digest?: string
/**
 * `sha256:` fingerprint of the bound runner key.
 */
key_fingerprint?: string
/**
 * The code of the latest refusal since the last binding, for example
 * `fact_mismatch`.
 */
last_refusal?: string
last_refused_at?: number
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "RuntimeRunnerList".
 */
export interface RuntimeRunnerList {
runners: RuntimeRunner[]
}
/**
 * What the scanner said about one import.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "ScanEvidence".
 */
export interface ScanEvidence1 {
exit_code: number
scanned_at_ms: number
scanner: string
stderr_sha256: string
/**
 * SHA-256 of the scanner's standard output and standard error, so the
 * full report can be matched to the scanner's own logs.
 */
stdout_sha256: string
/**
 * The first line of output (standard output, else standard error), at
 * most 200 bytes.
 */
summary: string
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "ServiceStatus".
 */
export interface ServiceStatus {
backup?: BackupHealth1
capabilities: string[]
clock?: ClockHealth1
/**
 * API contract ids this server serves, for client compatibility checks.
 */
contracts: string[]
profile: string
status: string
/**
 * The worst status of the host's certificates (#676), when any are
 * configured. It never fails readiness; `GET /v1/trust` has details.
 */
trust?: ("ok" | "warning" | "critical" | "expired")
/**
 * This server's version (#761).
 */
version: string
}
/**
 * Backup age as health reports it.
 */
export interface BackupHealth1 {
age_seconds?: number
max_age_seconds: number
/**
 * `ok`, `stale` (older than the threshold), `missing` (none taken yet)
 * or `unreadable` (the status file cannot be read).
 */
state: string
}
/**
 * The last clock reading, as health reports it.
 */
export interface ClockHealth1 {
measured_at_ms?: number
refuse_ms: number
/**
 * Time-source time minus local time, from the last successful reading.
 */
skew_ms?: number
/**
 * `ok`, `warn`, `refuse`, or `unknown` (no successful reading yet, or the
 * last measurement failed).
 */
state: string
warn_ms: number
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "SigningRoot".
 */
export interface SigningRoot {
/**
 * Why the file could not be read, when it could not.
 */
error?: string
file: string
purpose: string
/**
 * Whether a trust root's format records when each signer is valid.
 */
signer_validity?: "not_recorded"
signers: TrustedSignerView[]
/**
 * Whether an entry shows material the server loaded and uses, or a file as
 * it is on disk now, which a client that read it at startup adopts only
 * once restarted.
 */
source: ("loaded" | "file")
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "TrustedSignerView".
 */
export interface TrustedSignerView {
identity: string
key_id: string
/**
 * Revoked by the key revocations this process enforces.
 */
revoked: boolean
}
/**
 * One archive in the staging directory.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "StagedBundle".
 */
export interface StagedBundle {
/**
 * True when a `<stem>.chunks/` store sits beside the archive.
 */
chunked: boolean
/**
 * Present when the file parses as a bundle; signatures are not checked here.
 */
environment?: string
expires_at_ms?: number
file: string
plan_id?: string
size_bytes: number
/**
 * Why the file is not a readable bundle.
 */
unreadable?: string
}
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "StatusRow".
 */
export interface StatusRow {
channel: string
delivery_hold?: DeliveryHold3
deployed?: (string | null)
error?: (string | null)
head: string
health?: (string | null)
overlay_stale?: boolean
product: string
}
/**
 * Durable evidence that delivery is paused for a scope.
 */
export interface DeliveryHold3 {
actor: string
held_at: number
reason: string
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
/**
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "TrustPosture".
 */
export interface TrustPosture {
critical_days: number
revocation_list?: InstalledRevocations
/**
 * Runtime routes refuse a connection without a verified client
 * certificate, enrollment and renewal aside (#809).
 */
runtime_client_cert_required: boolean
signing: SigningRoot[]
/**
 * The worst certificate status; `ok` when nothing is about to lapse.
 */
status: ("ok" | "warning" | "critical" | "expired")
tls: CertificateEntry[]
warning_days: number
}
/**
 * One webhook delivery as `GET .../webhooks/deliveries` reports it.
 * 
 * This interface was referenced by `TenkaiHttpV1`'s JSON-Schema
 * via the `definition` "WebhookDelivery".
 */
export interface WebhookDelivery {
attempts: number
delivered_at?: number
event: string
id: string
/**
 * The last failure, as the worker recorded it.
 */
last_error?: string
next_attempt_at: number
/**
 * `pending`, `retrying` or `delivered`.
 */
state: string
url: string
}

export const TENKAI_CONTRACT = "tenkai.http.v1";
