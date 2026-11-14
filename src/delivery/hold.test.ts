import { describe, expect, it } from "vitest";
import { liftLine, recentAudit, windowLabel } from "./hold";

const THRESHOLD = {
  environment: "prod",
  count: 3,
  window_ms: 3_600_000,
  actor: "alice",
  set_at: 1_700_000_000_000,
};

describe("automatic holds", () => {
  it("prints the window as tenkaictl accepts it", () => {
    expect([3_600_000, 5_400_000, 90_000, 1_500, 0].map(windowLabel)).toStrictEqual([
      "1h",
      "90m",
      "90s",
      "1500ms",
      "0ms",
    ]);
  });

  it("says an automatic hold lifts itself only while a threshold is declared", () => {
    const automatic = { actor: "automatic", held_at: 1, reason: "automatic: 4 failed target(s)" };
    expect(liftLine(automatic, THRESHOLD)).toBe("lifts itself at 3 or fewer failed targets in 1h");
    expect(liftLine(automatic, undefined)).toBe("does not lift itself while no threshold is set");
    expect(liftLine({ ...automatic, actor: "alice" }, THRESHOLD)).toBe("never lifts itself");
  });

  it("leads the history with the latest transition", () => {
    const event = (at: number) => ({ action: "set", actor: "alice", at, reason: "r" });
    expect(recentAudit([1, 7, 3, 5, 2, 6].map(event)).map((item) => item.at)).toStrictEqual([
      7, 6, 5, 3, 2,
    ]);
  });
});
