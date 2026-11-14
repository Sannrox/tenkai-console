import { describe, expect, it } from "vitest";
import { deliveryLists, nextRound, type PageFetch } from "./delivery-pages";
import type { WebhookDelivery } from "./owners";

const delivery = (id: string): WebhookDelivery => ({
  id,
  event: "apply.failed",
  url: "https://hooks.example.test/a",
  state: "retrying",
  attempts: 1,
  next_attempt_at: 1,
});

const page = (
  key: string,
  cursor: string | undefined,
  ids: string[],
  next?: string,
): PageFetch => ({
  key,
  cursor,
  load: { kind: "ok", value: { items: ids.map(delivery), next } },
});

const failedPage = (key: string, cursor: string): PageFetch => ({
  key,
  cursor,
  load: { kind: "error", message: "Could not load" },
});

const ids = (rounds: PageFetch[][]) =>
  deliveryLists(rounds).map(({ key, load, next, moreFailed }) => ({
    key,
    ids: load.kind === "ok" ? load.value.map((item) => item.id) : load.kind,
    next,
    moreFailed,
  }));

describe("deliveryLists", () => {
  it("appends later pages without repeating a delivery already shown", () => {
    const rounds = [
      [page("prod", undefined, ["d3", "d2"], "c1")],
      [page("prod", "c1", ["d2", "d1"])],
    ];
    expect(ids(rounds)).toStrictEqual([
      { key: "prod", ids: ["d3", "d2", "d1"], next: undefined, moreFailed: false },
    ]);
    expect(nextRound(rounds)).toBeUndefined();
  });

  it("keeps what is shown and the cursor when a next page fails, then retries that page", () => {
    const rounds = [[page("prod", undefined, ["d2"], "c1")], [failedPage("prod", "c1")]];
    expect(ids(rounds)).toStrictEqual([{ key: "prod", ids: ["d2"], next: "c1", moreFailed: true }]);
    expect(nextRound(rounds)).toStrictEqual([{ key: "prod", cursor: "c1" }]);
    expect(ids([...rounds, [page("prod", "c1", ["d1"])]])).toStrictEqual([
      { key: "prod", ids: ["d2", "d1"], next: undefined, moreFailed: false },
    ]);
  });

  it("asks only lists with a cursor; a list without access stays as it was", () => {
    const first = [
      page("api", undefined, ["a2"], "a"),
      page("web", undefined, ["w1"]),
      { key: "ops", cursor: undefined, load: { kind: "forbidden" } } satisfies PageFetch,
    ];
    expect(nextRound([first])).toStrictEqual([{ key: "api", cursor: "a" }]);
    expect(ids([first]).map((list) => list.ids)).toStrictEqual([["a2"], ["w1"], "forbidden"]);
  });
});
