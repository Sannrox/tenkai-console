import { type } from "arktype";

// `EnvironmentInspectReport.identity_issuer` (Tenkai #1070 / #1073 / #1075).
// The pinned contract predates the field, so it is validated here rather
// than trusted as a generated type.
//
// Reuse decision
// Job: show the environment's workload identity issuer, rotation slot, and
// the instances that block the next step, with no actions.
// Verdict: Reuse
// Concept: extra inspect fields as in `drift.ts`; arktype parse as in
// `config-schema.ts`; environment-detail table as overlays.
// Edge: omitted identity_issuer is an older server; empty status is no
// issuer; waiting strings are instance plus why, never a count; empty
// recipients means the key is lost; pin stays. Server-host issuance was
// dropped (#1075); this view does not invent that setting. Created-by
// plan is not on the inspect type.
// Searched: identity_issuer, IssuerStatus, identity_issuer_waiting,
// Trust tab certificates, runtime empty. Rejected: pin bump; server-host
// copy; a countdown; plan links the inspect body does not carry.

const IssuerSummary = type({
  fingerprint: "string",
  generation: "number",
  recipients: "string[]",
  "+": "delete",
});

const IssuerStatus = type({
  "current?": IssuerSummary.or("null"),
  "next?": IssuerSummary.or("null"),
  "previous?": IssuerSummary.or("null"),
  "candidate?": IssuerSummary.or("null"),
  "requested?": "number | null",
  "+": "delete",
});

export type IssuerSlotRole = "current" | "next" | "previous" | "candidate";

export type IssuerSlot = {
  role: IssuerSlotRole;
  fingerprint: string;
  generation: string;
  recipients: string;
};

export type IssuerRotation = "none" | "active" | "add" | "issue" | "remove" | "blocked";

export type IssuerLoad =
  | { kind: "unavailable" }
  | { kind: "none" }
  | {
      kind: "ok";
      rotation: IssuerRotation;
      requested: string;
      slots: IssuerSlot[];
      waiting: string[];
    };

const slotOf = (
  role: IssuerSlotRole,
  value: { fingerprint: string; generation: number; recipients: string[] } | null | undefined,
): IssuerSlot | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }
  const fingerprint = value.fingerprint.trim();
  const recipients = value.recipients.map((name) => name.trim()).filter((name) => name !== "");
  return {
    role,
    fingerprint: fingerprint === "" ? "·" : fingerprint,
    generation: String(value.generation),
    recipients: recipients.length === 0 ? "lost" : recipients.join(", "),
  };
};

const waitingLines = (report: object): string[] => {
  if (!("identity_issuer_waiting" in report) || !Array.isArray(report.identity_issuer_waiting)) {
    return [];
  }
  return report.identity_issuer_waiting
    .filter((line): line is string => typeof line === "string")
    .map((line) => line.trim())
    .filter((line) => line !== "");
};

/** Issuer the inspect body actually sent. */
export const parseInspectIssuer = (report: unknown): IssuerLoad => {
  if (typeof report !== "object" || report === null || !("identity_issuer" in report)) {
    return { kind: "unavailable" };
  }
  if (report.identity_issuer === undefined || report.identity_issuer === null) {
    return { kind: "none" };
  }
  const status = IssuerStatus(report.identity_issuer);
  if (status instanceof type.errors) {
    return { kind: "unavailable" };
  }
  const slots = (
    [
      slotOf("current", status.current),
      slotOf("next", status.next),
      slotOf("previous", status.previous),
      slotOf("candidate", status.candidate),
    ] as const
  ).filter((slot): slot is IssuerSlot => slot !== undefined);
  const waiting = waitingLines(report);
  const requested =
    status.requested === null || status.requested === undefined ? "none" : String(status.requested);
  if (slots.length === 0 && requested === "none" && waiting.length === 0) {
    return { kind: "none" };
  }
  let rotation: IssuerRotation = "active";
  if (waiting.length > 0) {
    rotation = "blocked";
  } else if (status.next != null) {
    rotation = "issue";
  } else if (status.previous != null) {
    rotation = "remove";
  } else if (status.candidate != null || requested !== "none") {
    rotation = "add";
  } else if (slots.length === 0) {
    rotation = "none";
  }
  return { kind: "ok", rotation, requested, slots, waiting };
};
