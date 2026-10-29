import { describe, expect, it } from "vitest";
import type { ImportJob, StagedBundle } from "../api/tenkai.gen";
import { bundleCards, contentRows, finishedSince, importBody } from "./imports";

const bundle = (file: string): StagedBundle => ({
  file,
  size_bytes: 10,
  chunked: false,
  environment: "site",
  plan_id: "p1",
});

const job = (file: string, overrides: Partial<ImportJob>): ImportJob => ({
  schema: "tenkai.import-job.v1",
  id: `${file}-job`,
  bundle: file,
  upgrade: "u1",
  environment: "site",
  dry_run: true,
  state: "previewed",
  actor: "alice",
  started_at_ms: 1,
  preview: {
    already_bound: false,
    bundle_digest: "sha256:b1",
    carries_revocations: false,
    plan_id: "p1",
    release_ids: [],
  },
  ...overrides,
});

describe("import columns", () => {
  it("moves a bundle to checked after a passing dry run and to imported after a real import", () => {
    const cards = bundleCards(
      [bundle("a.tar"), bundle("b.tar"), bundle("c.tar"), bundle("d.tar")],
      [
        job("b.tar", {}),
        job("c.tar", { started_at_ms: 1 }),
        job("c.tar", { dry_run: false, state: "succeeded", started_at_ms: 2 }),
        job("d.tar", { state: "failed", refusal: "missing layer sha256:abc" }),
      ],
      { "b.tar": "u1", "c.tar": "u1", "d.tar": "u1" },
    );
    expect(cards.map((card) => [card.bundle.file, card.column, card.job?.refusal])).toStrictEqual([
      ["a.tar", "staged", undefined],
      ["b.tar", "checked", undefined],
      ["c.tar", "imported", undefined],
      ["d.tar", "staged", "missing layer sha256:abc"],
    ]);
  });

  it("drops a checked bundle back to staged when its upgrade no longer matches the dry run", () => {
    const passed = [job("b.tar", {})];
    expect(bundleCards([bundle("b.tar")], passed, { "b.tar": " u1 " })[0]?.column).toBe("checked");
    expect(bundleCards([bundle("b.tar")], passed, { "b.tar": "u2" })[0]?.column).toBe("staged");
    expect(bundleCards([bundle("b.tar")], passed, { "b.tar": "" })[0]?.column).toBe("staged");
    // Nothing entered yet, as after a reload: the passing dry run's upgrade.
    expect(bundleCards([bundle("b.tar")], passed, {})[0]?.column).toBe("checked");
    expect(
      bundleCards([{ ...bundle("b.tar"), environment: "other" }], passed, { "b.tar": "u1" })[0]
        ?.column,
    ).toBe("staged");
  });

  it("keeps a different archive under a known name staged", () => {
    const history = [
      job("b.tar", {}),
      job("b.tar", { dry_run: false, state: "succeeded", started_at_ms: 2 }),
    ];
    const replaced = { ...bundle("b.tar"), plan_id: "p2" };
    expect(bundleCards([replaced], history, {})[0]?.column).toBe("staged");
    expect(bundleCards([replaced], history, { "b.tar": "u1" })[0]?.column).toBe("staged");
    // Without a plan on either side the identity is unproven.
    const { plan_id: _plan, ...planless } = bundle("b.tar");
    expect(bundleCards([planless], history, {})[0]?.column).toBe("staged");
    const unproven = history.map((entry) => {
      const copy = structuredClone(entry);
      delete copy.preview;
      return copy;
    });
    expect(bundleCards([bundle("b.tar")], unproven, { "b.tar": "u1" })[0]?.column).toBe("staged");
  });

  it("sees one job finish while another still runs", () => {
    const a = job("a.tar", { id: "a", state: "running" });
    const b = job("b.tar", { id: "b", state: "running" });
    expect(finishedSince([a, b], [a, b])).toBe(false);
    expect(finishedSince([a, b], [{ ...a, state: "succeeded" }, b])).toBe(true);
    expect(
      finishedSince([{ ...a, state: "succeeded" }, b], [{ ...a, state: "succeeded" }, b]),
    ).toBe(false);
    expect(finishedSince(undefined, [a])).toBe(false);
  });

  it("builds the import request as tenkaictl binds", () => {
    expect(importBody("a.tar", "site", " u1 ", true)).toStrictEqual({
      version: 1,
      operation: "import",
      bundle: "a.tar",
      environment: "site",
      upgrade: "u1",
      dry_run: true,
    });
  });
});

describe("content rows", () => {
  it("lists each layer and weight with its release and what uses the release", () => {
    expect(
      contentRows({
        missing: [],
        releases: [
          {
            id: "r1",
            product: "app",
            version: "1.0.0",
            referenced_by: ["deployed prod"],
            content: [
              { digest: "sha256:l1", kind: "layer", size_bytes: 2_048, stored: true },
              { digest: "sha256:w1", kind: "weights" },
            ],
          },
        ],
      }),
    ).toStrictEqual([
      {
        release: "app 1.0.0",
        kind: "layer",
        digest: "sha256:l1",
        sizeBytes: 2_048,
        stored: true,
        usedBy: ["deployed prod"],
      },
      {
        release: "app 1.0.0",
        kind: "weights",
        digest: "sha256:w1",
        sizeBytes: undefined,
        stored: undefined,
        usedBy: ["deployed prod"],
      },
    ]);
  });
});
