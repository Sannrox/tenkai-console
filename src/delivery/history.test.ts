import { describe, expect, it, vi } from "vitest";
import {
  PAGE_SIZE,
  attemptAction,
  attemptDetail,
  attemptPlan,
  attemptTime,
  detailNeedsExpand,
  detailPreview,
  fetchHistory,
  historyPath,
  nextCursor,
  parseHistory,
  versionLine,
} from "./history";

const PAGE = {
  items: [
    {
      id: "dep:web:2",
      created_at: 1_700_000_001_000,
      instance: "web",
      product: "web",
      from_version: "1.0.0",
      to_version: "1.1.0",
      status: "succeeded",
      action: "upgrade",
      plan_id: "tenkai:plan:prod:2",
      detail: "",
    },
    {
      id: "dep:api:1",
      created_at: 1_700_000_000_000,
      instance: "api",
      product: "api",
      from_version: "1.0.0",
      to_version: "1.1.0",
      status: "failed",
      action: "upgrade",
      plan_id: "tenkai:plan:prod:1",
      detail: "probe failed",
    },
  ],
  next_cursor: "cursor-2",
};

const answering = (status: number, body: unknown) =>
  vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));

describe("parseHistory", () => {
  it("accepts a recorded page and unknown fields", () => {
    const parsed = parseHistory({
      ...PAGE,
      items: [
        {
          ...PAGE.items[0],
          cause: { phase: "health_probe", kind: "probe_failed", summary: "probe failed" },
        },
      ],
    });
    expect(parsed?.items).toHaveLength(1);
    expect(parsed?.items[0]).toMatchObject({ id: "dep:web:2", status: "succeeded" });
  });

  it("rejects a body without items", () => {
    expect(parseHistory({ next_cursor: "x" })).toBeUndefined();
  });
});

describe("historyPath", () => {
  it("pages with limit and optional instance and cursor", () => {
    expect(historyPath("prod")).toBe(`v1/environments/prod/history?limit=${PAGE_SIZE}`);
    expect(historyPath("prod", { instance: "api" })).toBe(
      `v1/environments/prod/history?limit=${PAGE_SIZE}&product=api`,
    );
    expect(historyPath("prod", { instance: "api", cursor: "c1" })).toBe(
      `v1/environments/prod/history?limit=${PAGE_SIZE}&product=api&cursor=c1`,
    );
  });
});

describe("attempt fields", () => {
  it("formats time, versions, and missing optional fields", () => {
    expect(attemptTime(1_700_000_000_000)).toBe("2023-11-14T22:13:20.000Z");
    expect(versionLine(PAGE.items[0]!)).toBe("1.0.0 -> 1.1.0");
    expect(
      versionLine({
        id: "d",
        created_at: 1,
        instance: "api",
        product: "api",
        to_version: "1.1.0",
        status: "succeeded",
        from_version: null,
      }),
    ).toBe("none -> 1.1.0");
    expect(
      attemptAction({
        id: "d",
        created_at: 1,
        instance: "api",
        product: "api",
        to_version: "1.1.0",
        status: "succeeded",
      }),
    ).toBe("none");
    expect(
      attemptPlan({
        id: "d",
        created_at: 1,
        instance: "api",
        product: "api",
        to_version: "1.1.0",
        status: "succeeded",
      }),
    ).toBe("none");
    expect(attemptDetail({ ...PAGE.items[0]! })).toBe("");
    expect(nextCursor(PAGE)).toBe("cursor-2");
    expect(nextCursor({ items: [] })).toBeUndefined();
    expect(nextCursor({ items: [], next_cursor: "" })).toBeUndefined();
  });

  it("collapses long detail and keeps a short line intact", () => {
    expect(detailNeedsExpand("probe failed")).toBe(false);
    expect(detailPreview("probe failed")).toBe("probe failed");
    const long = `${"x".repeat(81)}\nrest`;
    expect(detailNeedsExpand(long)).toBe(true);
    expect(detailPreview(long)).toBe(`${"x".repeat(80)}...`);
    expect(detailNeedsExpand("one\ntwo")).toBe(true);
    expect(detailPreview("one\ntwo")).toBe("one");
  });
});

describe("fetchHistory", () => {
  it("returns the page without putting the path in the load", async () => {
    const load = await fetchHistory("prod", "token", {}, answering(200, PAGE));
    expect(load).toEqual({ kind: "ok", value: PAGE });
  });

  it("sends instance filter as product and cursor as cursor", async () => {
    const fetch = answering(200, PAGE);
    await fetchHistory("prod", "token", { instance: "api", cursor: "c1" }, fetch);
    const called = fetch.mock.calls[0]?.[0];
    const href =
      called instanceof URL ? called.href : called instanceof Request ? called.url : called;
    expect(href).toContain(`v1/environments/prod/history?limit=${PAGE_SIZE}&product=api&cursor=c1`);
  });

  it("treats a missing route as unavailable", async () => {
    expect(await fetchHistory("prod", "token", {}, answering(404, { error: "not found" }))).toEqual(
      { kind: "unavailable" },
    );
    expect(await fetchHistory("prod", "token", {}, answering(405, { error: "nope" }))).toEqual({
      kind: "unavailable",
    });
  });

  it("treats a read refusal as forbidden", async () => {
    expect(await fetchHistory("prod", "token", {}, answering(403, { error: "denied" }))).toEqual({
      kind: "forbidden",
    });
  });

  it("hides HTTP status text from an unexpected error", async () => {
    expect(await fetchHistory("prod", "token", {}, answering(500, { error: "boom" }))).toEqual({
      kind: "error",
      message: "boom",
    });
    expect(await fetchHistory("prod", "token", {}, answering(502, { unexpected: true }))).toEqual({
      kind: "error",
      message: "Could not load",
    });
  });
});
