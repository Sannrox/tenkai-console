import { describe, expect, it } from "vitest";
import type { RuntimeRunner } from "../api/tenkai.gen";
import { age, filterEnvironments, runnerRows, runtimeEnvironment, shortId } from "./runners";

const NOW = 10 * 24 * 3_600_000;
const runner = (overrides: Partial<RuntimeRunner>): RuntimeRunner => ({
  id: "sha256:0123456789abcdef0123",
  environment: "prod",
  state: "active",
  instances: [],
  ...overrides,
});

describe("runner rows", () => {
  it("shows the newest pull and heartbeat of any instance, the latest version, and the lease", () => {
    const [row] = runnerRows(
      [
        runner({
          instances: [
            {
              instance_id: "b",
              holds_lease: false,
              last_work_at: NOW - 5 * 60_000,
              last_heartbeat_at: NOW - 20_000,
              runtime_version: "0.9.1",
              skew: "behind",
            },
            { instance_id: "a", holds_lease: true, last_work_at: NOW - 3 * 3_600_000 },
          ],
        }),
      ],
      "",
      NOW,
    );
    expect(row).toStrictEqual({
      id: "sha256:0123456789abcdef0123",
      environment: "prod",
      state: "active",
      lastPull: "5m",
      heartbeat: "<1m",
      version: "0.9.1 behind",
      lease: "held",
      revocable: true,
    });
  });

  it("filters by environment and offers revoke only for active credentials", () => {
    const rows = runnerRows(
      [
        runner({ id: "sha256:b", environment: "staging", state: "static" }),
        runner({ id: "sha256:c", state: "revoked" }),
        runner({ id: "sha256:a" }),
      ],
      "prod",
      NOW,
    );
    expect(rows.map((row) => [row.id, row.revocable, row.lastPull, row.version])).toStrictEqual([
      ["sha256:a", true, "none", "none"],
      ["sha256:c", false, "none", "none"],
    ]);
  });

  it("formats ages compactly", () => {
    expect(age(undefined, NOW)).toBe("none");
    expect(age(NOW - 59_000, NOW)).toBe("<1m");
    expect(age(NOW - 47 * 3_600_000, NOW)).toBe("47h");
    expect(age(NOW - 3 * 24 * 3_600_000, NOW)).toBe("3d");
  });

  it("lists every environment once", () => {
    expect(filterEnvironments([runner({ environment: "edge" })], ["prod", "edge"])).toStrictEqual([
      "edge",
      "prod",
    ]);
    expect(shortId("sha256:0123456789abcdef0123")).toBe("sha256:0123456789ab");
  });
});

describe("runtime environment", () => {
  it("names what a runtime host sets for its first start", () => {
    expect(
      runtimeEnvironment(
        { environment: "prod", token: "tke_once", expires_at: NOW },
        "https://tenkai.example.test",
      ),
    ).toBe(
      [
        "TENKAI_SERVER_URL=https://tenkai.example.test",
        "TENKAI_RUNTIME_ENVIRONMENT=prod",
        "TENKAI_RUNTIME_CREDENTIAL_FILE=/var/lib/tenkai-runtime/credential",
        "TENKAI_RUNTIME_ENROLLMENT_TOKEN=tke_once",
      ].join("\n"),
    );
  });
});
