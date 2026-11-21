import { describe, expect, it } from "vitest";
import type { ReleaseListEntry, ReleasePage } from "../api/tenkai.gen";
import { collectReleasePages } from "./releases";

const entry = (version: string): ReleaseListEntry => ({
  id: `tenkai:release:api@${version}`,
  product: "api",
  version,
  digest: "sha256:abc",
});

describe("collectReleasePages", () => {
  it("returns a single page when next_cursor is absent", async () => {
    const page = await collectReleasePages(async (cursor) => {
      expect(cursor).toBeUndefined();
      return { items: [entry("1.0.0")] };
    });
    expect(page.items.map((item) => item.version)).toEqual(["1.0.0"]);
  });

  it("follows next_cursor and concatenates items", async () => {
    const pages: ReleasePage[] = [
      { items: [entry("1.1.0")], next_cursor: "c2" },
      { items: [entry("1.0.0")] },
    ];
    const seen: (string | undefined)[] = [];
    const page = await collectReleasePages(async (cursor) => {
      seen.push(cursor);
      return pages[seen.length - 1]!;
    });
    expect(seen).toEqual([undefined, "c2"]);
    expect(page.items.map((item) => item.version)).toEqual(["1.1.0", "1.0.0"]);
  });

  it("fails when a cursor remains after 100 pages", async () => {
    await expect(
      collectReleasePages(async () => ({ items: [entry("1.0.0")], next_cursor: "more" })),
    ).rejects.toThrow("v1/releases: catalog exceeds 100 pages");
  });
});
