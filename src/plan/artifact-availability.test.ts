import { describe, expect, it } from "vitest";
import {
  ARTIFACT_COPY,
  ARTIFACT_LIMITS,
  allAvailable,
  artifactView,
  capRows,
} from "./artifact-availability";

const DIGEST_A = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const DIGEST_B = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const plan = (artifact_availability: unknown) => ({ artifact_availability });

describe("artifactView", () => {
  it("reads as empty when the plan has no checks or a malformed list", () => {
    expect(artifactView(undefined)).toEqual([]);
    expect(artifactView({})).toEqual([]);
    expect(artifactView(plan("nope"))).toEqual([]);
  });

  it("drops a malformed row and keeps the rest", () => {
    expect(
      artifactView(
        plan([
          { digest: DIGEST_A, registry: "mirror.internal", state: "available" },
          { digest: DIGEST_B, registry: "mirror.internal" },
        ]),
      ),
    ).toEqual([{ digest: DIGEST_A, registry: "mirror.internal", state: "available" }]);
  });

  it("puts unverifiable ahead of available so an approver sees it first", () => {
    expect(
      artifactView(
        plan([
          { digest: DIGEST_B, registry: "ghcr.io", state: "available" },
          { digest: DIGEST_A, registry: "mirror.internal", state: "unverifiable" },
        ]),
      ),
    ).toEqual([
      { digest: DIGEST_A, registry: "mirror.internal", state: "unverifiable" },
      { digest: DIGEST_B, registry: "ghcr.io", state: "available" },
    ]);
  });
});

describe("allAvailable", () => {
  it("is true only when every checked digest is available", () => {
    expect(allAvailable([])).toBe(false);
    expect(
      allAvailable([{ digest: DIGEST_A, registry: "mirror.internal", state: "available" }]),
    ).toBe(true);
    expect(
      allAvailable([{ digest: DIGEST_A, registry: "mirror.internal", state: "unverifiable" }]),
    ).toBe(false);
  });
});

describe("capRows", () => {
  it("counts rows past the page cap", () => {
    const rows = Array.from({ length: ARTIFACT_LIMITS.rows + 2 }, (_, index) => ({
      digest: `sha256:${index.toString().padStart(64, "0")}`,
      registry: "mirror.internal",
      state: "available" as const,
    }));
    const { shown, hidden } = capRows(rows);
    expect(shown).toHaveLength(ARTIFACT_LIMITS.rows);
    expect(hidden).toBe(2);
    expect(ARTIFACT_COPY.more(hidden)).toBe("2 more");
  });
});
