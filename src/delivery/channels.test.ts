import { describe, expect, it } from "vitest";
import type { ChannelListEntry, ChannelPage } from "../api/tenkai.gen";
import { collectChannelPages } from "./channels";

const entry = (id: string): ChannelListEntry => ({
  id,
  product: "api",
  name: id,
  head: "1.0.0",
});

describe("collectChannelPages", () => {
  it("returns a single page when next_cursor is absent", async () => {
    const page = await collectChannelPages(async (cursor) => {
      expect(cursor).toBeUndefined();
      return { items: [entry("stable")] };
    });
    expect(page.items.map((item) => item.id)).toEqual(["stable"]);
  });

  it("follows next_cursor and concatenates items", async () => {
    const pages: ChannelPage[] = [
      { items: [entry("stable")], next_cursor: "c2" },
      { items: [entry("edge")] },
    ];
    const seen: (string | undefined)[] = [];
    const page = await collectChannelPages(async (cursor) => {
      seen.push(cursor);
      return pages[seen.length - 1]!;
    });
    expect(seen).toEqual([undefined, "c2"]);
    expect(page.items.map((item) => item.id)).toEqual(["stable", "edge"]);
  });

  it("fails when a cursor remains after 100 pages", async () => {
    let calls = 0;
    await expect(
      collectChannelPages(async () => {
        calls += 1;
        return { items: [entry(String(calls))], next_cursor: "more" };
      }),
    ).rejects.toThrow("v1/channels: catalog exceeds 100 pages");
    expect(calls).toBe(100);
  });
});
