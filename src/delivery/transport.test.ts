import { describe, expect, it } from "vitest";
import type { CertificateEntry, RuntimeRunner, TrustPosture } from "../api/tenkai.gen";
import {
  byExpiry,
  describeCertificate,
  environmentAuth,
  firstExpiry,
  hubTransport,
  onDiskRoots,
  signerRows,
} from "./transport";

const certificate = (
  purpose: string,
  overrides: Partial<CertificateEntry> = {},
): CertificateEntry => ({
  purpose,
  file: `${purpose} in use`,
  source: "loaded",
  status: "ok",
  ...overrides,
});

const posture = (tls: CertificateEntry[]): TrustPosture => ({
  status: "ok",
  warning_days: 30,
  critical_days: 7,
  runtime_client_cert_required: true,
  signing: [],
  tls,
});

const runner = (
  environment: string,
  state: string,
  auth?: RuntimeRunner["auth"],
): RuntimeRunner => ({
  id: `${environment}-${state}-${auth ?? "unreported"}`,
  environment,
  state,
  instances: [],
  ...(auth === undefined ? {} : { auth }),
});

describe("hub transport", () => {
  it("is native with a listener certificate and names the client and runner CAs", () => {
    const runnerCa = certificate("runner_ca", { subject: "CN=runner-ca" });
    const transport = hubTransport(
      posture([certificate("listener"), certificate("tls_client_ca"), runnerCa]),
    );
    expect(transport.tls).toBe("native");
    expect(transport.clientCa.map((entry) => entry.purpose)).toStrictEqual(["tls_client_ca"]);
    expect(transport.runnerCa).toStrictEqual([runnerCa]);
  });

  it("keeps every runner CA mid-rotation, the expiring one first", () => {
    const current = certificate("runner_ca", { subject: "CN=runner-ca-2027" });
    const expiring = certificate("runner_ca", { subject: "CN=runner-ca-2026", status: "critical" });
    const transport = hubTransport(
      posture([certificate("listener"), certificate("listener"), current, expiring]),
    );
    expect(transport.runnerCa).toStrictEqual([expiring, current]);
    expect(transport.listener).toHaveLength(2);
  });

  it("is proxy or local without a listener certificate", () => {
    const transport = hubTransport(posture([certificate("outbound_ca_bundle")]));
    expect(transport).toStrictEqual({
      tls: "proxy or local",
      mtls: "required",
      listener: [],
      clientCa: [],
      runnerCa: [],
    });
  });

  it("reads mTLS as optional when not required, and unknown from a server before tenkai#809", () => {
    expect(hubTransport({ ...posture([]), runtime_client_cert_required: false }).mtls).toBe(
      "optional",
    );
    const { runtime_client_cert_required: _omitted, ...older } = posture([]);
    expect(hubTransport(older as TrustPosture).mtls).toBe("unknown");
  });

  it("describes a certificate by subject and expiry, or by the server's error", () => {
    expect(
      describeCertificate(
        certificate("runner_ca", {
          subject: "CN=runner-ca",
          not_after: Date.UTC(2026, 11, 1) / 1_000,
          days_left: 34,
        }),
      ),
    ).toBe("CN=runner-ca, until 2026-12-01 (34 days)");
    expect(describeCertificate(certificate("runner_ca", { error: "reading x: missing" }))).toBe(
      "reading x: missing",
    );
    expect(describeCertificate(certificate("runner_ca"))).toBe("runner_ca in use");
  });
});

describe("environment runner auth", () => {
  it("counts live runners by auth per environment, revoked excluded, unreported as unknown", () => {
    expect(
      environmentAuth(
        [
          runner("prod", "active", "client_certificate"),
          runner("prod", "static", "bearer"),
          runner("prod", "revoked", "bearer"),
          runner("prod", "active"),
          runner("lab", "active", "bearer"),
        ],
        ["prod", "staging"],
      ),
    ).toStrictEqual([
      { environment: "lab", runners: 1, mtls: 0, bearer: 1, unknown: 0 },
      { environment: "prod", runners: 3, mtls: 1, bearer: 1, unknown: 1 },
      { environment: "staging", runners: 0, mtls: 0, bearer: 0, unknown: 0 },
    ]);
  });
});

describe("trust tables", () => {
  it("orders certificates by expiry, an unreadable one first, and names the first to lapse", () => {
    const later = certificate("listener", { not_after: 2_000, status: "ok" });
    const soon = certificate("runner_ca", { not_after: 1_000, status: "warning" });
    const unreadable = certificate("outbound_ca_bundle", { status: "critical", error: "missing" });
    expect(byExpiry([later, soon, unreadable])).toStrictEqual([unreadable, soon, later]);
    expect(firstExpiry(posture([later, soon]))).toStrictEqual(soon);
    expect(firstExpiry(posture([later]))).toBeUndefined();
  });

  it("marks each signer trusted or revoked, merging a key two sources list", () => {
    const signer = (key_id: string, identity: string, revoked = false) => ({
      key_id,
      identity,
      revoked,
    });
    expect(
      signerRows([
        {
          purpose: "release",
          file: "release trust in use",
          source: "loaded",
          signers: [signer("k1", "ci"), signer("k2", "release-bot", true)],
        },
        {
          purpose: "release",
          file: "release.toml",
          source: "file",
          signers: [signer("k1", "ci"), signer("k3", "rotated")],
        },
        {
          purpose: "approval",
          file: "approval.toml",
          source: "file",
          signers: [],
          error: "reading approval.toml: missing",
        },
        { purpose: "bundle_import", file: "bundles.toml", source: "file", signers: [] },
      ]).map((row) => [row.purpose, row.identity, row.sources, row.state, row.tone]),
    ).toStrictEqual([
      ["approval", "", ["file"], "reading approval.toml: missing", "bad"],
      ["bundle_import", "", ["file"], "no signers", "warning"],
      ["release", "ci", ["loaded", "file"], "trusted", "ok"],
      ["release", "release-bot", ["loaded"], "revoked", "bad"],
      ["release", "rotated", ["file"], "trusted", "ok"],
    ]);
  });

  it("notes only roots read from disk, not one the server reports as loaded", () => {
    const root = (source: "file" | "loaded") => ({
      purpose: "release",
      file: `release ${source}`,
      source,
      signers: [],
    });
    expect(onDiskRoots([root("loaded"), root("file")])).toStrictEqual([root("file")]);
  });
});
