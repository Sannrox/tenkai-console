import { describe, expect, it } from "vitest";
import { ApiError } from "../api/http";
import type { MatchedExposure } from "../api/tenkai.gen";
import type { RecallView } from "./recall";
import {
  COPY,
  advisoriesFor,
  exposureLine,
  isHealthRecall,
  offerAdmit,
  pendingFixes,
  releaseSpec,
  upgradeGate,
  upgradeOutcome,
} from "./recalled-upgrade";

const sub = (
  product: string,
  state: string,
  deployed: string | null,
  head: string,
  instance?: string,
) => ({ product, channel: "stable", state, deployed, head, ...(instance ? { instance } : {}) });

const recall = (overrides: Partial<RecallView> = {}): RecallView => ({
  release: "api@1.1.0",
  covers_future: false,
  ...overrides,
});

const match = (release: string, advisory_id: string): MatchedExposure => ({
  advisory_id,
  severity: "high",
  component: "openssl",
  component_version: "1.1.1",
  release,
  release_id: `tenkai:release:${release}`,
});

describe("pendingFixes", () => {
  it("keeps behind instances with a pin and a head, as product@version", () => {
    expect(
      pendingFixes([
        sub("api", "behind", "1.0.0", "1.1.0"),
        sub("web", "current", "2.0.0", "2.0.0"),
        sub("worker", "behind", null, "0.9.0"),
        sub("edge", "behind", "0.1.0", "0.2.0", "edge-a"),
      ]),
    ).toEqual([
      { instance: "api", current: "api@1.0.0", target: "api@1.1.0" },
      { instance: "edge-a", current: "edge@0.1.0", target: "edge@0.2.0" },
    ]);
  });
});

describe("releaseSpec", () => {
  it("does not double-prefix a catalog id", () => {
    expect(releaseSpec("api", "api@1.0.0")).toBe("api@1.0.0");
  });
});

describe("isHealthRecall", () => {
  it("treats a policy or measured soak recall as health", () => {
    expect(isHealthRecall(recall())).toBe(false);
    expect(isHealthRecall(recall({ policy_id: "soak" }))).toBe(true);
    expect(isHealthRecall(recall({ failing_share: 0.2 }))).toBe(true);
    expect(isHealthRecall(recall({ recalled_by: "oidc:alice" }))).toBe(false);
  });
});

describe("advisoriesFor", () => {
  it("lists the feed's advisories for one release, ignoring others", () => {
    expect(
      advisoriesFor(
        [
          match("api@1.0.0", "TENKAI-2026-2"),
          match("api@1.1.0", "TENKAI-2026-1"),
          match("api@1.0.0", "TENKAI-2026-1"),
          match("web@1.0.0", "TENKAI-2026-9"),
        ],
        "api@1.0.0",
      ),
    ).toEqual(["TENKAI-2026-1", "TENKAI-2026-2"]);
    expect(exposureLine(["TENKAI-2026-1", "TENKAI-2026-2"])).toBe("TENKAI-2026-1 · TENKAI-2026-2");
    expect(exposureLine([])).toBe(COPY.none);
  });
});

describe("upgradeGate", () => {
  it("maps named gates and credential refusals, never the server's text", () => {
    expect(upgradeGate(new TypeError("network"))).toBe("unknown");
    expect(upgradeGate(new ApiError(503, "store.rs:42"))).toBe("unknown");
    expect(upgradeGate(new ApiError(403, "insufficient delivery capability"))).toBe("forbidden");
    expect(upgradeGate(new ApiError(405, "method not allowed"))).toBe("unavailable");
    expect(
      upgradeGate(
        new ApiError(
          409,
          "recalled_upgrade_not_lower: api@1.1.0 blocking advisories [TENKAI-2026-1] are not a proper subset of api@1.0.0 [TENKAI-2026-1]",
        ),
      ),
    ).toBe("equal");
    expect(
      upgradeGate(
        new ApiError(409, "recalled_upgrade_unbound: api@1.1.0 is not bound to an advisory"),
      ),
    ).toBe("operator");
    expect(upgradeGate(new ApiError(409, "recalled_upgrade_unevaluable: no feed"))).toBe(
      "unevaluable",
    );
    expect(upgradeGate(new ApiError(409, "head is recalled"))).toBe("refused");
  });

  it("uses fixed copy for each gate", () => {
    expect(upgradeOutcome(undefined)).toEqual({ tone: "ok", text: COPY.admitted });
    expect(upgradeOutcome(new ApiError(409, "recalled_upgrade_not_lower: x")).text).toBe(
      COPY.equal,
    );
    expect(upgradeOutcome(new TypeError("network"))).toEqual({
      tone: "unknown",
      text: COPY.unknown,
    });
  });
});

describe("offerAdmit", () => {
  it("offers only a non-health recall the caller may manage, until a terminal gate", () => {
    const open = { recalled: true, health: false, permitted: true, gate: undefined };
    expect(offerAdmit(open)).toBe(true);
    expect(offerAdmit({ ...open, health: true })).toBe(false);
    expect(offerAdmit({ ...open, permitted: false })).toBe(false);
    expect(offerAdmit({ ...open, recalled: false })).toBe(false);
    expect(offerAdmit({ ...open, gate: "equal" })).toBe(false);
    expect(offerAdmit({ ...open, gate: "operator" })).toBe(false);
    expect(offerAdmit({ ...open, gate: "forbidden" })).toBe(false);
    expect(offerAdmit({ ...open, gate: "refused" })).toBe(true);
  });
});
