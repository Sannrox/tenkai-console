import { describe, expect, it } from "vitest";
import type { CertificateEntry, RuntimeRunner, TrustPosture } from "../api/tenkai.gen";
import { describeCertificate, environmentAuth, hubTransport } from "./transport";

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
  signing: [],
  tls,
});

const runner = (
  environment: string,
  state: string,
  id = `${environment}-${state}`,
): RuntimeRunner => ({
  id,
  environment,
  state,
  instances: [],
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
      listener: [],
      clientCa: [],
      runnerCa: [],
    });
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
  it("counts live runners and static bearer tokens per environment, revoked excluded", () => {
    expect(
      environmentAuth(
        [
          runner("prod", "active"),
          runner("prod", "static"),
          runner("prod", "revoked"),
          runner("lab", "active"),
        ],
        ["prod", "staging"],
      ),
    ).toStrictEqual([
      { environment: "lab", runners: 1, bearer: 0 },
      { environment: "prod", runners: 2, bearer: 1 },
      { environment: "staging", runners: 0, bearer: 0 },
    ]);
  });
});
