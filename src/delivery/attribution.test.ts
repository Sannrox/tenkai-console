import { describe, expect, it } from "vitest";
import { attributed, failureGroups, type Source } from "./attribution";
import type { WebhookDelivery } from "./owners";

const delivery = (id: string, url: string, sources?: Source[]): WebhookDelivery => ({
  id,
  event: "apply.failed",
  url,
  state: "retrying",
  attempts: 2,
  next_attempt_at: 1,
  last_error: "connection refused",
  ...(sources === undefined ? {} : { sources }),
});

const ENV = { kind: "environment", name: "prod" };
const PRODUCT = { kind: "product", name: "api" };
const OWNERS: Record<string, string> = { "environment prod": "ops@x", "product api": "api@x" };
const ownerOf = (source: Source) => OWNERS[`${source.kind} ${source.name}`];

describe("failureGroups", () => {
  it("keeps a shared URL as one group naming both sources, never one of them", () => {
    const groups = failureGroups(
      [delivery("d1", "https://shared", [PRODUCT, ENV]), delivery("d2", "https://env", [ENV])],
      ownerOf,
    );
    expect(groups.map((group) => [group.sources, group.failures, group.urls])).toStrictEqual([
      [[{ ...ENV, owner: "ops@x" }], 1, ["https://env"]],
      [
        [
          { ...ENV, owner: "ops@x" },
          { ...PRODUCT, owner: "api@x" },
        ],
        1,
        ["https://shared"],
      ],
    ]);
  });

  it("puts deliveries without sources last as unattributed and reads unknown owners as ·", () => {
    const groups = failureGroups(
      [
        delivery("d1", "https://old"),
        delivery("d2", "https://web", [{ kind: "product", name: "web" }]),
      ],
      ownerOf,
    );
    expect(groups.map((group) => [group.sources, group.urls])).toStrictEqual([
      [[{ kind: "product", name: "web", owner: "·" }], ["https://web"]],
      [[], ["https://old"]],
    ]);
  });

  it("counts a delivery listed twice once and skips delivered, queued and synthetic rows", () => {
    const shared = delivery("d1", "https://shared", [ENV, PRODUCT]);
    const groups = failureGroups(
      [
        shared,
        shared,
        { ...delivery("d2", "https://a", [ENV]), state: "delivered", delivered_at: 5 },
        { ...delivery("d3", "https://a", [ENV]), state: "pending", attempts: 0 },
        { ...delivery("d4", "", []), state: "unconfigured", attempts: 0 },
      ],
      ownerOf,
    );
    expect(groups.map((group) => group.failures)).toStrictEqual([1]);
  });
});

describe("attributed", () => {
  it("is false when no row names a source: an older server, so unknown", () => {
    expect(attributed([delivery("d1", "https://a")])).toBe(false);
    expect(attributed([])).toBe(false);
    expect(attributed([delivery("d1", "https://a"), delivery("d2", "https://b", [ENV])])).toBe(
      true,
    );
  });
});
