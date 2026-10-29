import type { ExportEntry, ExportKind, ExportRequest } from "../api/tenkai.gen";

/**
 * The Operations screen (#37) over server backups (GET/POST `/v1/backups`,
 * Sannrox/tenkai#672) and exports (`/v1/exports`, Sannrox/tenkai#682), with
 * drill history and export retention (Sannrox/tenkai#818), and ranged audit
 * exports (Sannrox/tenkai#825). Every value is the server's.
 */

/** Each kind, what it needs besides a reason, and how a row names it. */
export const EXPORT_KINDS = [
  { kind: "support-bundle", label: "Support bundle", needs: [] },
  // The next chain entry, or with from/to the existing entries in that range.
  { kind: "audit-export", label: "Audit export", needs: [] },
  { kind: "recovery-bundle", label: "Recovery bundle", needs: ["environment", "plan_id"] },
  { kind: "offline-receipt", label: "Offline receipt", needs: ["environment", "upgrade"] },
] as const satisfies ReadonlyArray<{
  kind: ExportKind;
  label: string;
  needs: ReadonlyArray<"environment" | "plan_id" | "upgrade">;
}>;

export type ExportFields = {
  environment: string;
  plan_id: string;
  upgrade: string;
  /** Audit export only: both or neither, as entered. */
  from_sequence: string;
  to_sequence: string;
};

/** Most chain entries one ranged audit export holds, as the server bounds it. */
export const MAX_RANGE_ENTRIES = 1_000;

/**
 * The audit range entered, `undefined` for the next chain entry, or why it
 * is not a range the server takes: whole numbers from 1, from no higher
 * than to, at most `MAX_RANGE_ENTRIES` entries.
 */
export const auditRange = (
  from: string,
  to: string,
): { from_sequence: number; to_sequence: number } | undefined | string => {
  const [start, end] = [from.trim(), to.trim()];
  if (start === "" && end === "") {
    return undefined;
  }
  if (start === "" || end === "") {
    return "from and to go together";
  }
  if (!/^\d+$/.test(start) || !/^\d+$/.test(end)) {
    return "from and to are whole sequence numbers";
  }
  const [first, last] = [Number(start), Number(end)];
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) {
    return "from and to are whole sequence numbers";
  }
  if (first < 1 || first > last) {
    return "from is 1 or more and no higher than to";
  }
  if (last - first + 1 > MAX_RANGE_ENTRIES) {
    return `at most ${MAX_RANGE_ENTRIES} entries`;
  }
  return { from_sequence: first, to_sequence: last };
};

/**
 * The request body for `kind`, or what is still missing. Fields a kind does
 * not take are left out, as the server refuses them.
 */
export const exportRequest = (
  kind: ExportKind,
  reason: string,
  fields: ExportFields,
): ExportRequest | string => {
  const needs: ReadonlyArray<"environment" | "plan_id" | "upgrade"> =
    EXPORT_KINDS.find((entry) => entry.kind === kind)?.needs ?? [];
  if (!reason.trim()) {
    return "a reason is required";
  }
  const missing = needs.filter((field) => !fields[field].trim());
  if (missing.length > 0) {
    return `${missing.join(" and ")} required`;
  }
  const range =
    kind === "audit-export" ? auditRange(fields.from_sequence, fields.to_sequence) : undefined;
  if (typeof range === "string") {
    return range;
  }
  return {
    kind,
    reason: reason.trim(),
    ...Object.fromEntries(needs.map((field) => [field, fields[field].trim()])),
    ...range,
  };
};

export type HistoryRow = {
  id: string;
  kind: ExportKind;
  environment: string;
  fileName: string;
  createdAt: number;
  /** Who created it, from its first `created` event. */
  createdBy: string;
  reason: string;
  sizeBytes: number;
  downloads: number;
  /** When it stops being downloadable, with a retention on the server. */
  expiresAt: number | undefined;
  /** Past its retention or already removed: listed, never downloadable. */
  expired: boolean;
  /** The audit chain entries an audit export covers: `4`, or `3 to 7`. */
  sequences: string;
};

/** One row per export, newest first as the server lists them. */
export const historyRows = (exports: ExportEntry[]): HistoryRow[] =>
  exports.map((entry) => {
    const created = entry.events.find((event) => event.action === "created");
    return {
      id: entry.id,
      kind: entry.kind,
      environment: entry.environment ?? "",
      fileName: entry.file_name,
      createdAt: entry.created_at_ms,
      createdBy: created?.principal ?? "",
      reason: created?.reason ?? "",
      sizeBytes: entry.size_bytes,
      downloads: entry.events.filter((event) => event.action === "downloaded").length,
      expiresAt: entry.expires_at_ms,
      expired: entry.expired,
      sequences:
        entry.audit_range === undefined
          ? ""
          : entry.audit_range.from === entry.audit_range.to
            ? `${entry.audit_range.from}`
            : `${entry.audit_range.from} to ${entry.audit_range.to}`,
    };
  });

/** `512 B`, `3.4 KB`, `1.2 MB`. */
export const size = (bytes: number): string =>
  bytes < 1_024
    ? `${bytes} B`
    : bytes < 1_048_576
      ? `${(bytes / 1_024).toFixed(1)} KB`
      : `${(bytes / 1_048_576).toFixed(1)} MB`;
